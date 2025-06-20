package com.rule.test.ruletest.drool;

import org.kie.api.KieServices;
import org.kie.api.builder.*;
import org.kie.api.runtime.KieContainer;
import org.kie.api.runtime.KieSession;
import org.kie.internal.io.ResourceFactory;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.core.io.Resource;
import org.springframework.core.io.support.PathMatchingResourcePatternResolver;
import org.springframework.core.io.support.ResourcePatternResolver;

import java.io.IOException;

@Configuration
public class RuleConfig {
    private static final String RULES_PATH = "rules/";


    @Bean
    KieContainer kieContainer() {
        KieServices kieServices = KieServices.Factory.get();
        KieFileSystem kieFileSystem = kieServices.newKieFileSystem();

        // Load rules from resources
        Resource[] files;
        try {
            files = new PathMatchingResourcePatternResolver()
                    .getResources("classpath*:rules/*.*");

            for (Resource file : files) {
                System.out.println("Loading rule file: " + file.getFilename());
                kieFileSystem.write(ResourceFactory
                        .newClassPathResource("rules/" + file.getFilename(), "UTF-8"));
            }

            KieBuilder kieBuilder = kieServices.newKieBuilder(kieFileSystem);
            kieBuilder.buildAll();

            // Check for errors
            if (kieBuilder.getResults().hasMessages(Message.Level.ERROR)) {
                throw new RuntimeException("Build Errors:\n"
                        + kieBuilder.getResults().toString());
            }

            return kieServices.newKieContainer(
                    kieServices.getRepository().getDefaultReleaseId());
        } catch (IOException e) {
            throw new RuntimeException("Error loading rule files", e);
        }

    }

    @Bean
    KieSession kieSession(KieContainer kieContainer) {
        return kieContainer.newKieSession();
    }
}
