#!/bin/bash
# save as get-windows-password.sh

if [ "$#" -ne 2 ]; then
    echo "Usage: $0 <region> <profile>"
    echo "Example: $0 ap-south-2 nagsupra"
    exit 1
fi

REGION=$1
PROFILE=$2

# Get the secret ARN and instance ID from CloudFormation outputs
echo "Getting stack outputs..."
SECRET_ARN=$(aws cloudformation describe-stacks \
    --stack-name FoundationStack \
    --query 'Stacks[0].Outputs[?OutputKey==`PrivateKeySecretArn`].OutputValue' \
    --output text \
    --region $REGION \
    --profile $PROFILE)

INSTANCE_ID=$(aws cloudformation describe-stacks \
    --stack-name FoundationStack \
    --query 'Stacks[0].Outputs[?OutputKey==`SQLServerInstanceId`].OutputValue' \
    --output text \
    --region $REGION \
    --profile $PROFILE)

# Get the private key from Secrets Manager
echo "Retrieving private key from Secrets Manager..."
PRIVATE_KEY=$(aws secretsmanager get-secret-value \
    --secret-id $SECRET_ARN \
    --query 'SecretString' \
    --output text \
    --region $REGION \
    --profile $PROFILE)

# Save private key to a temporary file
TEMP_KEY_FILE=$(mktemp)
echo "$PRIVATE_KEY" > "$TEMP_KEY_FILE"
chmod 400 "$TEMP_KEY_FILE"

echo "Private key saved to temporary file: $TEMP_KEY_FILE"

# Wait for password data to be available
echo "Waiting for password data to be available..."
aws ec2 wait password-data-available \
    --instance-id $INSTANCE_ID \
    --region $REGION \
    --profile $PROFILE

# Get the Windows password
echo "Getting Windows password..."
PASSWORD=$(aws ec2 get-password-data \
    --instance-id $INSTANCE_ID \
    --priv-launch-key "$TEMP_KEY_FILE" \
    --region $REGION \
    --profile $PROFILE \
    --query 'PasswordData' \
    --output text)

# Clean up the temporary file
rm "$TEMP_KEY_FILE"

echo "Windows Administrator Password: $PASSWORD"
