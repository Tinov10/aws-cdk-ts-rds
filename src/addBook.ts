import { Handler } from 'aws-lambda';
import { SecretsManager } from 'aws-sdk';
import { Client } from 'pg';

// Important we get the credentials_arn but this is NOT the secret itself
// to fetch the actual secret we use the secretClient
const CREDENTIALS_ARN = process.env.CREDENTIALS_ARN!;
const HOST = process.env.HOST!;

const secretsClient = new SecretsManager();

interface IAddEvent {
  isbn: string;
  name: string;
  authors: string[];
  languages: string[];
  countries: string[];
  numberOfPages: number;
  releaseDate: string;
}

export const handler: Handler = async (event: IAddEvent) => {
  try {
    // Retrieve RDS User credentials with secretsClient

    console.log('retrieving library credentials...');

    const credentialsSecret = await secretsClient

      .getSecretValue({ SecretId: CREDENTIALS_ARN })
      .promise();

    const userCredentials = JSON.parse(
      credentialsSecret.SecretString as string
    );

    // Instantiate RDS Client
    console.log('instantiating rds client...');

    const userClient = new Client({
      host: HOST,
      user: userCredentials.user,
      password: userCredentials.password,
      database: 'librarydb',
      port: 5432,
    });

    // Connect to RDS instance
    console.log('connecting to rds...');
    await userClient.connect();

    console.log('adding book...');
    await userClient.query(
      `INSERT INTO library (isbn, name, authors, languages, countries, numberOfPages, releaseDate) VALUES('${event.isbn}', '${event.name}', '{${event.authors}}', '{${event.languages}}', '{${event.countries}}', '${event.numberOfPages}', '${event.releaseDate}')`
    );

    // Break connection
    console.log('tasks completed!');
    await userClient.end();
  } catch (error) {
    console.error('Error creating database:', error);
    throw error;
  }
};
