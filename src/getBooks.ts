import { Handler } from 'aws-lambda';
import { SecretsManager } from 'aws-sdk';
import { Client } from 'pg';

const CREDENTIALS_ARN = process.env.CREDENTIALS_ARN!;
const HOST = process.env.HOST!;

const secretsClient = new SecretsManager();

export const handler: Handler = async () => {
  try {
    // Retrieve RDS User credentials
    console.log('retrieving library credentials...');
    const credentialsSecret = await secretsClient
      .getSecretValue({ SecretId: CREDENTIALS_ARN })
      .promise();
    const credentials = JSON.parse(credentialsSecret.SecretString as string);

    // Instantiate RDS Client
    console.log('instantiating rds client...');
    const userClient = new Client({
      host: HOST,
      user: credentials.user,
      password: credentials.password,
      database: 'librarydb',
      port: 5432,
    });

    // Connect to RDS instance
    console.log('connecting to rds...');
    await userClient.connect();

    console.log('getting books...');
    const query = await userClient.query('SELECT * FROM library LIMIT 10');
    console.log(query.rows);

    // Break connection
    console.log('tasks completed!');
    await userClient.end();
  } catch (error) {
    console.error('Error creating database:', error);
    throw error;
  }
};
