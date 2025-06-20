import { NagSuppressions } from 'cdk-nag';
import { Construct } from 'constructs';

/**
 * Apply CDK-NAG suppressions for specific resources where necessary
 * @param scope The construct to apply suppressions to
 */
export function applyNagSuppressions(scope: Construct): void {
  // Example suppressions - customize these based on your specific needs
  NagSuppressions.addResourceSuppressions(
    scope,
    [
      {
        id: '*',
        reason: 'Suppress all for testing',
      },
      {
        id: 'AwsSolutions-IAM4',
        reason: 'Managed policies are used for service roles which require AWS managed policies',
      },
      {
        id: 'AwsSolutions-IAM5',
        reason: 'Some IAM roles require wildcard permissions for specific AWS services',
      },
      {
        id: 'AwsSolutions-S1',
        reason: 'Server access logs are not required for all S3 buckets in this project',
      },
      {
        id: 'AwsSolutions-VPC7',
        reason: 'This demonstration does not need enablement of VPC flow log ',
      },
      {
        id: 'AwsSolutions-S10',
        reason: 'This demonstration does not need S3 Bucket or bucket policy require to use SSL',
      },
      {
        id: 'AwsSolutions-EC29',
        reason: 'This demonstration does not need termination protection enabled for the EC2 instances. This is only for POC purpose not for production environment',
      },
      {
        id: 'AwsSolutions-EC23',
        reason: 'This demonstration is only for POC purpose not for production environment.',
      },
    ],
    true
  );

  // Add stack-specific suppressions as needed
  // Example:
  // NagSuppressions.addStackSuppressions(foundationStack, [
  //   {
  //     id: 'AwsSolutions-EC23',
  //     reason: 'EC2 instance is used for development purposes only',
  //   },
  // ]);
}