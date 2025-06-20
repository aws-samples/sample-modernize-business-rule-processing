import json
import os
import requests
import pandas as pd
import pyarrow as pa
import pyarrow.parquet as pq
from aws_lambda_powertools import Logger
from aws_lambda_powertools.utilities.typing import LambdaContext
#from aws_lambda_powertools.logging import correlation_paths
from typing import Dict, Any, List
import io
import boto3
from http import HTTPStatus
from datetime import datetime

# Initialize logger with service name and log correlation
logger = Logger(
    service="parellal-rule-process",
    level="INFO"
)

# Validate configuration at cold start
def validate_config() -> None:
    required_vars = ['RULE_ENGINE_SERVICE_URL', 'GOLD_BUCKET_NAME']
    missing_vars = [var for var in required_vars if not os.environ.get(var)]
    
    if missing_vars:
        logger.error("Missing required environment variables", extra={
            "missing_variables": missing_vars
        })
        raise ConfigError(f"Missing required environment variables: {', '.join(missing_vars)}")

class RuleEngineClient:
    def __init__(self, api_endpoint: str):
        self.api_endpoint = api_endpoint
        self.headers = {
            'Accept': 'application/json',
            'Content-Type': 'application/json'
        }

    def process_rules(self, payload: Dict[str, Any]) -> Dict[str, Any]:
        logger.info("Processing rules with payload", extra={"payload": payload})
        try:
            response = requests.post(
                self.api_endpoint,
                json=payload,
                headers=self.headers,
                timeout=30
            )
            response.raise_for_status()
            return response.json()
        except requests.exceptions.RequestException as e:
            raise APIError(f"API call failed: {str(e)}")

class S3Handler:
    def __init__(self, bucket: str):
        self.bucket = bucket
        self.s3_client = boto3.client('s3')

    def save_parquet(self, table: pa.Table, key: str) -> None:
        buffer = io.BytesIO()
        pq.write_table(table, buffer, compression='snappy')
        buffer.seek(0)
        self.s3_client.put_object(
            Bucket=self.bucket,
            Key=key,
            Body=buffer.getvalue()
        )

# Initialize global variables and clients
try:
    validate_config()
    rule_engine = RuleEngineClient(os.environ['RULE_ENGINE_SERVICE_URL'])
    s3_handler = S3Handler(os.environ['GOLD_BUCKET_NAME'])
    logger.info("Successfully initialized global clients")
except Exception as e:
    logger.error("Failed to initialize global clients", extra={"error": str(e)})
    raise


class ConfigError(Exception):
    """Custom exception for configuration errors"""
    pass

class APIError(Exception):
    """Custom exception for API-related errors"""
    pass


def validate_partition_info(partition_info: Dict[str, str]) -> None:
    required_fields = ['year', 'month', 'day', 'hour', 'minute']
    if not all(partition_info.get(field) for field in required_fields):
        raise ValueError("Missing partition information")

def generate_s3_key(partition_info: Dict[str, str], batch_id: str, timestamp: str) -> str:
    return (f"final_result/year={partition_info['year']}"
            f"/month={partition_info['month']}"
            f"/day={partition_info['day']}"
            f"/batch_{batch_id}_{timestamp}.parquet")

def process_items(items: List[Dict[str, Any]],  
                 rule_engine: RuleEngineClient) -> List[Dict[str, Any]]:
    processed_results = []
    
    for item in items:
        
        result = rule_engine.process_rules(item)
        
        # Add item information to the result for tracking
        result['processed_item_id'] = item.get('id', 'unknown')
        result['processing_timestamp'] = datetime.utcnow().isoformat()
        
        processed_results.append(result)

    logger.info(f"Completed processed", extra={"processed_count": len(processed_results)})    
        
    return processed_results

@logger.inject_lambda_context(log_event=True)
def lambda_handler(event: Dict[str, Any], context: LambdaContext) -> Dict[str, Any]:
    logger.info("Received event", extra={"event": event})
    try:
        if not event.get('Input'):
            raise KeyError("Event object missing 'message.Items' structure")

        input_data = event.get('Input')
        logger.info(f"Processing payload with {len(input_data.get('Items', []))} items")
        partition_info = input_data.get('BatchInput', {}).get('partition_info', {})
        validate_partition_info(partition_info)
        processed_results = process_items(input_data['Items'], rule_engine)
        
        # Convert results to DataFrame and then to Parquet
        df = pd.DataFrame(processed_results)
        table = pa.Table.from_pandas(df)

        # Generate unique filename using timestamp
        timestamp = datetime.utcnow().strftime('%Y%m%d_%H%M%S')
        s3_key = generate_s3_key(partition_info, context.aws_request_id, timestamp)
        
        # Save to S3
        s3_handler.save_parquet(table, s3_key)
        logger.info(f"Successfully processed items {len(processed_results)} and saved to s3://{os.environ['GOLD_BUCKET_NAME']}/{s3_key}")

        return {
            'statusCode': HTTPStatus.OK,
            'body': {
                'message': f'Successfully processed {len(processed_results)} items',
                'location': f"s3://{os.environ['GOLD_BUCKET_NAME']}/{s3_key}",
                'processed_count': len(processed_results)
            },
            'headers': {'Content-Type': 'application/json'}
        }

    except (ConfigError, KeyError, ValueError, json.JSONDecodeError) as e:
        logger.error(f"Client error: {str(e)}")
        return {
            'statusCode': HTTPStatus.BAD_REQUEST,
            'body': {'error': 'Client error', 'message': str(e)}
        }
    except APIError as e:
        logger.error(f"API error: {str(e)}")
        return {
            'statusCode': HTTPStatus.INTERNAL_SERVER_ERROR,
            'body': {'error': 'API error', 'message': str(e)}
        }
    except Exception as e:
        logger.error(f"Unexpected error: {str(e)}")
        return {
            'statusCode': HTTPStatus.INTERNAL_SERVER_ERROR,
            'body': {'error': 'Internal server error', 'message': str(e)}
        }