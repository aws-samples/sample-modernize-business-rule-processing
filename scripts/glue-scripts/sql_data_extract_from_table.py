import sys
from typing import Dict, Any, Optional, List
from awsglue.transforms import *
from awsglue.utils import getResolvedOptions
from pyspark.context import SparkContext
from awsglue.context import GlueContext
from awsglue.job import Job
from awsglue.dynamicframe import DynamicFrame
from pyspark.sql.functions import year, month, dayofmonth, col, lit
from pyspark.sql import SparkSession
import logging
from datetime import datetime
from decimal import Decimal
from concurrent.futures import ThreadPoolExecutor
import boto3
from botocore.config import Config

class GlueETLJob:
    def __init__(self, job_args: Dict[str, str]):
        """Initialize Glue ETL job with configurations."""
        self.job_args = job_args
        self.setup_logging()
        self.initialize_spark()
        self.setup_job_context()
        self.setup_aws_clients()
        

    def setup_logging(self) -> None:
        """Configure enhanced logging with proper format."""
        logging.basicConfig(
            level=logging.INFO,
            format='%(asctime)s - %(levelname)s - %(message)s - %(filename)s:%(lineno)d'
        )
        self.logger = logging.getLogger(__name__)

    def initialize_spark(self) -> None:
        """Initialize Spark with minimal custom configurations."""
        try:
            # Only set configs that need customization
            spark_configs = {
                "spark.sql.adaptive.enabled": "true",  # Enable adaptive query execution
                "spark.sql.shuffle.partitions": "200",  # Adjust based on data volume
                "spark.sql.broadcastTimeout": "7200"    # For large broadcast joins if needed
            }

            # Initialize Spark session
            self.spark = SparkSession.builder

            # Apply minimal custom configs
            for key, value in spark_configs.items():
                self.spark = self.spark.config(key, value)

            self.spark = self.spark.getOrCreate()
            self.sc = self.spark.sparkContext
            self.sc.setLogLevel("ERROR")
            self.glueContext = GlueContext(self.sc)

            self.logger.info("Spark session initialized successfully")

        except Exception as e:
            self.logger.error(f"Error initializing Spark: {str(e)}")
            raise


    def setup_job_context(self) -> None:
        
        self.job = Job(self.glueContext)
        self.job.init(self.job_args['JOB_NAME'], self.job_args)
        
        # Initialize job parameters with validation
        self.job_name = self.job_args['JOB_NAME']
        self.connection_name = self.job_args['CONNECTION_NAME']
        self.s3_output_path = self.job_args['S3_OUTPUT_PATH'].rstrip('/')
        self.table_name = self.job_args['TABLE_NAME']
        self.hash_col_name = self.job_args['HASH_COL_NAME']
        self.partition_key = self.job_args['partition_key']
        self.metrics_table_name = self.job_args['METRICS_TABLE_NAME']
        #self.job_run_id = self._generate_run_id()
        self.metrics_tracker = JobMetricsTracker(self.job_name,
                                                 self.table_name,
                                                 self.partition_key,
                                                 self.metrics_table_name)

    def _generate_run_id(self) -> str:
        """Generate a fallback run ID if not available."""
        return f"manual-{datetime.now().strftime('%Y%m%d-%H%M%S')}"
    
    def setup_aws_clients(self) -> None:
        """Initialize AWS clients with retry configuration."""
        config = Config(
            retries=dict(
                max_attempts=3,
                mode='adaptive'
            )
        )
        self.s3_client = boto3.client('s3', config=config)
        self.cloudwatch = boto3.client('cloudwatch')
        self.glue = boto3.client('glue')

    def get_connection_options(self) -> Dict[str, str]:
        """Create optimized connection options with enhanced settings."""
        self.logger.info(f"Creating connection options for {self.connection_name}")
        return {
            "useConnectionProperties": "true",
            "connectionName": self.connection_name,
            "dbtable": self.table_name,
            "hashexpression": self.hash_col_name,
            "hashpartitions": "10",
            "jobBookmarkKeys": [self.hash_col_name],
            "jobBookmarkKeysSortOrder": "ASC",
            "fetchsize": "10000"
        }

    def process_dynamic_frame(self, df: DynamicFrame) -> DynamicFrame:
        """Process dynamic frame with optimized transformations and error handling."""
        try:
            # Performance monitoring
            start_time = datetime.now()
            self.logger.info(f"Starting data processing for {self.table_name}")

            # Cache the dataframe if needed
            if self.needs_caching(df):
                df.toDF().cache()
                self.logger.info("DataFrame cached for optimization")

            # Convert to DataFrame for transformation
            spark_df = df.toDF()
            initial_count = spark_df.count()
            self.logger.info(f"Initial record count: {initial_count}")

            # Get current date for partitioning
            current_date = datetime.now()
            
            # Add partition columns efficiently with zero-padded formatting
            spark_df = spark_df.withColumn("year", lit(f"{current_date.year:04d}")) \
                              .withColumn("month", lit(f"{current_date.month:02d}")) \
                              .withColumn("day", lit(f"{current_date.day:02d}"))
            
            # Log the partitions for verification
            self.logger.info(f"Added partition columns: year={current_date.year:04d}, "
                            f"month={current_date.month:02d}, day={current_date.day:02d}")
        
            final_count = spark_df.count()
            if final_count != initial_count:
                raise ValueError(f"Record count mismatch: {initial_count} -> {final_count}")

            # Convert back to DynamicFrame
            result_frame = DynamicFrame.fromDF(spark_df, self.glueContext, "processed_frame")
            
            # Log processing metrics
            duration = (datetime.now() - start_time).total_seconds()
            self.logger.info(f"Processing completed in {duration} seconds. Records: {final_count}")
            
            return result_frame

        except Exception as e:
            self.logger.error(f"Error processing dynamic frame: {str(e)}", exc_info=True)
            raise

    def needs_caching(self, df: DynamicFrame) -> bool:
        """Determine if dataframe needs caching based on size and complexity."""
        try:
            record_count = df.count()
            schema_length = len(df.schema())
            return record_count > 100000 or schema_length > 20
        except Exception as e:
            self.logger.warning(f"Error in caching determination: {str(e)}")
            return False

    def write_to_s3(self, df: DynamicFrame) -> None:
        """Write data to S3 with optimized settings and validation."""
        try:
            # Validate DataFrame before writing
            if not self.validate_dataframe(df):
                raise ValueError("DataFrame validation failed")

            s3_output = f"{self.s3_output_path}/{self.table_name}"
            
            # Write with optimized settings
            self.glueContext.write_dynamic_frame.from_options(
                frame=df,
                connection_type="s3",
                connection_options={
                    "path": s3_output,
                    "compression": "snappy",
                    "partitionKeys": ["year", "month", "day"],
                    "maxFileSize": 134217728,  # 128MB
                    "maxRecordsPerFile": 100000,
                    "writeMode": "overwrite"
                },
                format="parquet",
                transformation_ctx=f"datasink_{self.table_name}"
            )
            
            self.logger.info(f"Successfully wrote data to {s3_output}")
            
        except Exception as e:
            self.logger.error(f"Error writing to S3: {str(e)}", exc_info=True)
            raise

    def validate_dataframe(self, df: DynamicFrame) -> bool:
        """Validate DataFrame before writing."""
        try:
            # Check for required partition columns
            schema = df.schema()
            required_columns = ["year", "month", "day"]
            
            for col in required_columns:
                if col not in [field.name for field in schema.fields]:
                    self.logger.error(f"Missing required partition column: {col}")
                    return False

            # Validate record count
            count = df.count()
            if count == 0:
                self.logger.error("DataFrame is empty")
                return False

            return True

        except Exception as e:
            self.logger.error(f"Error validating DataFrame: {str(e)}")
            return False

    def execute(self) -> None:
        """Main execution method with comprehensive error handling and monitoring."""
        start_time = datetime.now()
        job_metrics = {}
        
        try:
            self.logger.info(f"Starting ETL job for table: {self.table_name}")
            read_start = datetime.now()
            source_df = self.glueContext.create_dynamic_frame.from_options(
                connection_type="sqlserver",  # Changed from "sqlserver" to "custom.jdbc"
                connection_options=self.get_connection_options(),
                transformation_ctx=f"datasource_{self.table_name}" # Important for bookmarking
            )
            read_duration = (datetime.now() - read_start).total_seconds()
            job_metrics['read_duration'] = str(read_duration)
            job_metrics['source_count'] = source_df.count()
            
            # Process data with metrics
            process_start = datetime.now()
            processed_df = self.process_dynamic_frame(source_df)
            process_duration = (datetime.now() - process_start).total_seconds()
            job_metrics['process_duration'] = str(process_duration)
            
            # Write data with metrics
            self.logger.info(f"#####Fetched record count======  {job_metrics['source_count']}")
            write_start = datetime.now()
            if job_metrics['source_count'] > 0:
                self.write_to_s3(processed_df)
                # Update first/last processed IDs if available
                first_id = source_df.toDF().orderBy(col(self.hash_col_name).asc()).first()[self.hash_col_name]
                last_id = source_df.toDF().orderBy(col(self.hash_col_name).desc()).first()[self.hash_col_name]
                self.logger.info(f"First ID: {first_id}, Last ID: {last_id}")
                job_metrics['first_id'] = str(first_id )
                job_metrics['last_id'] = str(last_id)
                #self.metrics_tracker.update_processed_ids(first_id, last_id)
                # Store metrics in DynamoDB instead of setting job marker
                
            
            write_duration = (datetime.now() - write_start).total_seconds()
            job_metrics['write_duration'] = str(write_duration)
            
            # Log comprehensive metrics
            job_metrics['total_duration'] = str((datetime.now() - start_time).total_seconds())

            self.metrics_tracker.store_metrics_in_dynamodb(job_metrics)
            self.logger.info(
                f"Job completed successfully:\n"
                f"- Total Duration: {job_metrics['total_duration']} seconds\n"
                f"- Read Duration: {job_metrics['read_duration']} seconds\n"
                f"- Process Duration: {job_metrics['process_duration']} seconds\n"
                f"- Write Duration: {job_metrics['write_duration']} seconds\n"
                f"- Records Processed: {job_metrics['source_count']}"
            )         

        except Exception as e:
            self.logger.error(f"Job failed: {str(e)}", exc_info=True)
            raise
        finally:
            self.job.commit()

class JobMetricsTracker:
    def __init__(self, job_name: str, table_name: str, partition_key: str, metrics_table_name: str):
        self.table_name = table_name
        self.job_name = job_name
        self.cloudwatch = boto3.client('cloudwatch')
        self.dynamodb = boto3.resource('dynamodb')
        self.partition_key = partition_key
        self.metrics_table_name = metrics_table_name
        
        self.metrics_table = self.dynamodb.Table(self.metrics_table_name)
        self.first_processed_id = None
        self.last_processed_id = None
        self.start_time = datetime.now()
    
    def update_processed_ids(self, first_id: str = None, last_id: str = None) -> None:
        """Update the first and last processed IDs"""
        if first_id and self.first_processed_id is None:
            self.first_processed_id = first_id
        if last_id:
            self.last_processed_id = last_id
        
    def store_metrics_in_dynamodb(self, job_metrics: Dict) -> None:
        """Store job metrics in DynamoDB table instead of using job markers"""
       
        # Using partition key from job arguments or default value
        self.metrics_table.put_item(
            Item={
                'partitionKey': self.partition_key,
                'jobName': self.job_name,
                'dbTableName': self.table_name,
                'firstProcessedId': job_metrics.get('first_id', ''),
                'lastProcessedId': job_metrics.get('last_id',''),
                'recordsProcessed': job_metrics['source_count'],
                'processingTime': job_metrics['total_duration'],
                'processedTime': datetime.now().isoformat()
            }
        )            

def main():
    """Main entry point with enhanced error handling."""
    try:
        
        required_args = ['JOB_NAME', 'CONNECTION_NAME', 'S3_OUTPUT_PATH', 'TABLE_NAME', 'HASH_COL_NAME', 'METRICS_TABLE_NAME','partition_key']
        args = getResolvedOptions(sys.argv, required_args)
        missing_args = [arg for arg in required_args if arg not in args]
        
        if missing_args:
            raise ValueError(f"Missing required arguments: {', '.join(missing_args)}")
        
        
        etl_job = GlueETLJob(args)
        etl_job.execute()
        
    except Exception as e:
        logging.error(f"Failed to execute ETL job: {str(e)}", exc_info=True)
        sys.exit(1)

if __name__ == "__main__":
    main()
