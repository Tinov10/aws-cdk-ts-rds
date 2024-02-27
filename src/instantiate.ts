import { Handler } from 'aws-lambda';
import { SecretsManager } from 'aws-sdk';
import { Client } from 'pg';

const secretsClient = new SecretsManager();
const RDS_ARN = process.env.RDS_ARN!;
const CREDENTIALS_ARN = process.env.CREDENTIALS_ARN!;
// we don't use the host because it is included in the adminSecret

export const handler: Handler = async () => {
  try {
    // Retrieve RDS Admin credentials with secretsClient
    console.log('retrieving admin credentials...');

    const adminSecret = await secretsClient
      .getSecretValue({ SecretId: RDS_ARN })
      .promise();

    const adminCredentials = JSON.parse(adminSecret.SecretString as string); // also include the host

    // Retrieve RDS User credentials with secretsClient
    console.log('retrieving library credentials...');

    const credentialsSecret = await secretsClient
      .getSecretValue({ SecretId: CREDENTIALS_ARN })
      .promise();

    const userCredentials = JSON.parse(
      credentialsSecret.SecretString as string
    );

    // Instantiate RDS Client with adminCredentials
    console.log('instantiating client with admin...');

    const adminClient = new Client({
      host: adminCredentials.host,
      user: adminCredentials.username,
      password: adminCredentials.password,
      database: 'postgres', // postgres
      port: 5432,
    });

    // Connect to RDS instance with adminCredentials
    console.log('connecting to rds with admin...');

    await adminClient.connect();

    console.log('setting up new database...');

    // Create db
    await adminClient.query('CREATE DATABASE librarydb;'); // librarydb

    // Create new user
    await adminClient.query(
      `CREATE USER ${userCredentials.user} WITH PASSWORD '${userCredentials.password}';`
    );

    // Grant privileges to new user
    await adminClient.query(
      `GRANT ALL PRIVILEGES ON DATABASE librarydb TO ${userCredentials.user};`
    );

    console.log('setup completed!');

    await adminClient.end();

    // Instantiate RDS Client with userCredentials
    console.log('instantiating client with new user...');

    const userClient = new Client({
      host: adminCredentials.host,
      user: userCredentials.user,
      password: userCredentials.password,
      database: 'librarydb', // librarydb
      port: 5432,
    });

    // Connect to RDS instance with userCredentials
    console.log('connecting to rds with new user...');

    await userClient.connect();

    console.log('creating new table...');

    const createTableCommand = [
      'CREATE TABLE library (',
      'isbn VARCHAR(50) UNIQUE NOT NULL, ',
      'name VARCHAR(50) NOT NULL, ',
      'authors VARCHAR(50)[] NOT NULL, ',
      'languages VARCHAR(50)[] NOT NULL, ',
      'countries VARCHAR(50)[] NOT NULL, ',
      'numberOfPages integer, ',
      'releaseDate VARCHAR(50) NOT NULL);',
    ];
    await userClient.query(createTableCommand.join(''));

    console.log('tasks completed!');

    await userClient.end();
  } catch (error) {
    console.error('Error creating database:', error);
    throw error;
  }
};
