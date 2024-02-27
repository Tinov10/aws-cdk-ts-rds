import { Duration, Stack, StackProps } from 'aws-cdk-lib';
import { Construct } from 'constructs';

// VPC
import {
  Vpc,
  SubnetType,
  SecurityGroup,
  Port,
  InterfaceVpcEndpointAwsService,
  InstanceType,
  InstanceClass,
  InstanceSize,
} from 'aws-cdk-lib/aws-ec2';

// Role
import {
  Role,
  CompositePrincipal,
  ServicePrincipal,
  PolicyStatement,
  Effect,
} from 'aws-cdk-lib/aws-iam';

// RDS
import {
  DatabaseInstance,
  DatabaseInstanceEngine,
  PostgresEngineVersion,
  Credentials,
} from 'aws-cdk-lib/aws-rds';

// Secret
import { Secret } from 'aws-cdk-lib/aws-secretsmanager';

// Lambda
import { Runtime } from 'aws-cdk-lib/aws-lambda';
import { NodejsFunction } from 'aws-cdk-lib/aws-lambda-nodejs';
import {
  AwsCustomResource,
  PhysicalResourceId,
  AwsCustomResourcePolicy,
} from 'aws-cdk-lib/custom-resources';

export class AwsCdkTsRdsStack extends Stack {
  constructor(scope: Construct, id: string, props?: StackProps) {
    super(scope, id, props);

    // Create vpc
    const vpc = new Vpc(this, 'VPC', {
      vpcName: 'rds-vpc',
      maxAzs: 2,
      natGateways: 0,
      subnetConfiguration: [
        {
          subnetType: SubnetType.PRIVATE_ISOLATED,
          cidrMask: 24,
          name: 'rds',
        },
      ],
    });

    // Create 2 SGs
    const securityGroupResolvers = new SecurityGroup(
      this,
      'SecurityGroupResolvers',
      //
      {
        vpc,
        securityGroupName: 'resolvers-sg',
        description: 'Security Group with Resolvers',
      }
    );

    const securityGroupRds = new SecurityGroup(
      this,
      'SecurityGroupRds',
      //
      {
        vpc,
        securityGroupName: 'rds-sg',
        description: 'Security Group with RDS',
      }
    );

    // Ingress and Egress Rules
    // SG 1 --> SG 2
    securityGroupRds.addIngressRule(
      securityGroupResolvers,
      Port.tcp(5432),
      'Allow inbound traffic to RDS'
    );

    // VPC Interfaces
    vpc.addInterfaceEndpoint('LAMBDA', {
      service: InterfaceVpcEndpointAwsService.LAMBDA,
      subnets: { subnets: vpc.isolatedSubnets },
      securityGroups: [securityGroupResolvers],
    });
    vpc.addInterfaceEndpoint('SECRETS_MANAGER', {
      service: InterfaceVpcEndpointAwsService.SECRETS_MANAGER,
      subnets: { subnets: vpc.isolatedSubnets },
      securityGroups: [securityGroupResolvers],
    });

    // Create role
    const role = new Role(this, 'Role', {
      roleName: 'rds-role',
      assumedBy: new CompositePrincipal(
        new ServicePrincipal('ec2.amazonaws.com'),
        new ServicePrincipal('lambda.amazonaws.com')
      ),
      description: 'Role used in the RDS stack',
    });

    role.addToPolicy(
      new PolicyStatement({
        effect: Effect.ALLOW,
        actions: [
          'cloudwatch:PutMetricData',
          //
          'ec2:CreateNetworkInterface',
          'ec2:DescribeNetworkInterfaces',
          'ec2:DeleteNetworkInterface',
          'ec2:DescribeInstances',
          'ec2:DescribeSubnets',
          'ec2:DescribeSecurityGroups',
          'ec2:DescribeRouteTables',
          //
          'logs:CreateLogGroup',
          'logs:CreateLogStream',
          'logs:PutLogEvents',
          //
          'lambda:InvokeFunction',
          //
          'secretsmanager:GetSecretValue',
          //
          'kms:decrypt',
          //
          'rds-db:connect',
        ],
        resources: ['*'],
      })
    );

    // Create Rds
    const rdsInstance = new DatabaseInstance(this, 'PostgresRds', {
      vpc,
      securityGroups: [securityGroupRds],
      vpcSubnets: { subnets: vpc.isolatedSubnets },
      availabilityZone: vpc.isolatedSubnets[0].availabilityZone,
      instanceType: InstanceType.of(InstanceClass.T4G, InstanceSize.SMALL),
      //
      engine: DatabaseInstanceEngine.postgres({
        version: PostgresEngineVersion.VER_14_6,
      }),
      credentials: Credentials.fromUsername('libraryadmin'),
      port: 5432,
      instanceIdentifier: 'librarydb-instance',
      allocatedStorage: 10,
      maxAllocatedStorage: 10,
      deleteAutomatedBackups: true,
      backupRetention: Duration.millis(0),

      publiclyAccessible: false,
    });

    rdsInstance.secret?.grantRead(role);

    // Secret from SM
    const credentials = Secret.fromSecretCompleteArn(
      this,
      'CredentialsSecret',
      'arn:aws:secretsmanager:eu-west-1:589482729342:secret:rds-db-creds-0LrrGg'
    );
    credentials.grantRead(role);

    // Function for cretating lambdas
    const createLambda = (name: string, entry: string) =>
      new NodejsFunction(this, name, {
        functionName: name,
        bundling: {
          externalModules: ['pg-native'],
        },
        entry: entry,
        vpc,
        vpcSubnets: { subnets: vpc.isolatedSubnets },
        securityGroups: [securityGroupResolvers],
        environment: {
          RDS_ARN: rdsInstance.secret!.secretArn,
          HOST: rdsInstance.dbInstanceEndpointAddress,
          //
          CREDENTIALS_ARN: credentials.secretArn,
        },

        runtime: Runtime.NODEJS_18_X,
        //
        role,
        timeout: Duration.minutes(2),
      });

    // create lambda 1 with function --> automatically trigger
    const instantiateLambda = createLambda('instantiate', 'src/instantiate.ts');
    instantiateLambda.node.addDependency(rdsInstance);

    // Custom Resource to trigger instantiate function automatically
    const customResource = new AwsCustomResource(this, 'TriggerInstantiate', {
      functionName: 'trigger-instantiate',
      role,
      onUpdate: {
        service: 'Lambda',
        action: 'invoke',
        parameters: {
          FunctionName: instantiateLambda.functionName,
        },
        physicalResourceId: PhysicalResourceId.of('TriggerInstantiate'),
      },
      policy: AwsCustomResourcePolicy.fromSdkCalls({
        resources: [instantiateLambda.functionArn],
      }),
    });
    customResource.node.addDependency(instantiateLambda);

    // create lambda 2 --> no trigger
    const addBookLambda = createLambda('add-book', 'src/addBook.ts');
    addBookLambda.node.addDependency(rdsInstance);

    // create lambda 3 with function --> no trigger
    const getBooksLambda = createLambda('get-books', 'src/getBooks.ts');
    getBooksLambda.node.addDependency(rdsInstance);
  }
}
