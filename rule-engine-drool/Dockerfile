# Use AmazonCorreto 17 as the base image
FROM public.ecr.aws/amazoncorretto/amazoncorretto:17

# Set working directory
WORKDIR /app

# Copy the JAR file
COPY target/*.jar app.jar

# Expose the port your application runs on (typically 8080 for Spring Boot)
EXPOSE 8080

# Command to run the application
ENTRYPOINT ["java", "-jar", "app.jar"]