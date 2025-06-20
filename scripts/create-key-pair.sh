#!/bin/bash
# save as create-key-pair.sh

if [ "$#" -ne 2 ]; then
    echo "Usage: $0 <region> <profile>"
    exit 1
fi

REGION=$1
PROFILE=$2
KEY_NAME="sql-server-keypair-${REGION}"
# Get the directory where the script is located
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
# Set keypairs directory relative to script location
KEY_DIR="${SCRIPT_DIR}/../keypairs"

# Create directory if it doesn't exist and set permissions
if [ ! -d "$KEY_DIR" ]; then
    echo "Creating directory: $KEY_DIR"
    mkdir -p "$KEY_DIR"
    chmod 755 "$KEY_DIR"
fi

KEY_PATH="$KEY_DIR/${KEY_NAME}.pem"

# Delete existing key pair if it exists
if aws ec2 describe-key-pairs --key-names "$KEY_NAME" --region "$REGION" --profile "$PROFILE" >/dev/null 2>&1; then
    echo "Deleting existing key pair..."
    aws ec2 delete-key-pair \
        --key-name "$KEY_NAME" \
        --region "$REGION" \
        --profile "$PROFILE"
fi

# Create new key pair
echo "Creating new key pair..."
# First create a temporary file with correct permissions
TEMP_KEY_FILE=$(mktemp)
aws ec2 create-key-pair \
    --key-name "$KEY_NAME" \
    --query 'KeyMaterial' \
    --output text \
    --region "$REGION" \
    --profile "$PROFILE" > "$TEMP_KEY_FILE"

# Set permissions on the temporary file
chmod 400 "$TEMP_KEY_FILE"

# Move the file to the final location
mv "$TEMP_KEY_FILE" "$KEY_PATH"

echo "Key pair created and private key saved to: $KEY_PATH"
