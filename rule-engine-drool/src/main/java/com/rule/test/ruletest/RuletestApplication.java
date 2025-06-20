package com.rule.test.ruletest;

import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;

@SpringBootApplication (scanBasePackages = "com.rule.test.ruletest")
public class RuletestApplication {

	public static void main(String[] args) {
		SpringApplication.run(RuletestApplication.class, args);
	}

}
