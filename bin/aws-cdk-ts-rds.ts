#!/usr/bin/env node
import 'source-map-support/register';
import * as cdk from 'aws-cdk-lib';
import { AwsCdkTsRdsStack } from '../lib/aws-cdk-ts-rds-stack';

const app = new cdk.App();
new AwsCdkTsRdsStack(app, 'AwsCdkTsRdsStack', {});
