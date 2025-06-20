package com.rule.test.ruletest.rest.controller;

import com.rule.test.ruletest.vo.*;
import org.kie.api.runtime.KieContainer;
import org.kie.api.runtime.KieSession;
// import org.kie.api.runtime.rule.FactHandle;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RestController;

import java.util.Collection;
import java.util.Map;
import java.util.HashMap;

@RestController
public class InsurancePremiumRestController {

    private final KieContainer kieContainer;

    public InsurancePremiumRestController(KieContainer kieContainer) {
        this.kieContainer = kieContainer;
    }



    private void printFactsMessage(KieSession kieSession) {
        Collection<?> facts = kieSession.getObjects();

        StringBuilder msg = new StringBuilder("\nAll facts:\n");
        for (Object fact : facts) {
            msg.append("    ").append(fact).append("\n");
        }
        System.out.println(msg.toString());
    }

    @GetMapping ("/health")
    public ResponseEntity <Map<String, String>> healthCheck() {
        Map<String, String> response = new HashMap<>();

        try {
            // Verify KieContainer is available
            if (kieContainer != null && kieContainer.verify().hasMessages()) {
                response.put("status", "DOWN");
                response.put("message", "Rules engine not available");
                return ResponseEntity.<Map<String, String>>status(HttpStatus.SERVICE_UNAVAILABLE)
                        .body(response);
            }
            response.put("status", "UP");
            response.put("message", "Service is running");
            return ResponseEntity.<Map<String, String>>ok(response);

        } catch (Exception e) {
            response.put("status", "DOWN");
            response.put("message", "Service health check failed: " + e.getMessage());
            return ResponseEntity.status(HttpStatus.SERVICE_UNAVAILABLE).body(response);
        }
    }

    @PostMapping (value = "/policy/premium", consumes = {MediaType.APPLICATION_JSON_VALUE,MediaType.APPLICATION_XML_VALUE}, produces = {MediaType.APPLICATION_JSON_VALUE,MediaType.APPLICATION_XML_VALUE})
    public ResponseEntity<?> getPremium(@RequestBody InsuranceRequest requestObj){
        System.out.println("handling request****");

        //Car carObj = requestObj.getCar();
        Car carObj1 = new Car(requestObj.getCarid(),requestObj.getMake(),requestObj.getModel(),requestObj.getYear(), requestObj.getStyle(), requestObj.getColor());
        System.out.println("###########CAR##########");
        System.out.println(carObj1.toString());

        System.out.println("###########POLICY##########");
        //Policy policyObj = requestObj.getPolicy();
        Policy policyObj1 = new Policy(requestObj.getPolicyid(), requestObj.getPremium());
        System.out.println(policyObj1.toString());

        System.out.println("###########DRIVER##########");
        //Driver driverObj = requestObj.getDriver();
        Driver driverObj1 = new Driver(requestObj.getDriverid(), requestObj.getAge(), requestObj.getName());
        System.out.println(driverObj1.toString());

        KieSession kieSession = kieContainer.newKieSession();
        try{
            kieSession.insert(carObj1);
            kieSession.insert(policyObj1);
            kieSession.insert(driverObj1);

            // Before firing rules
            System.out.println("Facts before rule execution:");
            printFactsMessage(kieSession);

            // Fire rules
            int x= kieSession.fireAllRules();
            System.out.println("Number of Rules executed: " + x);

            // After firing rules
            System.out.println("Facts after rule execution:");
            printFactsMessage(kieSession);
            InsuranceResponse response = new InsuranceResponse(policyObj1.getPremium(),carObj1.getColor(),driverObj1.getId(),policyObj1.getId(),carObj1.getYear(),driverObj1.getName(),carObj1.getModel(),carObj1.getStyle(),carObj1.getMake(),driverObj1.getAge(),carObj1.getId());
            return ResponseEntity.ok(response);

        } finally {
            kieSession.dispose();
        }

    }


}
