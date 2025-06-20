package com.rule.test.ruletest.rest.controller;

import org.drools.core.event.DefaultAgendaEventListener;
import org.kie.api.event.rule.AfterMatchFiredEvent;

import java.util.Collection;

public class RuleTrackingEventListener extends DefaultAgendaEventListener {
    @Override
    public void matchCreated(org.kie.api.event.rule.MatchCreatedEvent event) {
        System.out.println("Match created: " + event.getMatch().getRule().getName());
    }

    @Override
    public void afterMatchFired(AfterMatchFiredEvent event) {
        String ruleName = event.getMatch().getRule().getName();
        Collection<?> facts = event.getKieRuntime().getObjects();

        System.out.println("Rule fired: " + ruleName);
        System.out.println("Facts after rule execution:");
        facts.forEach(fact -> System.out.println("    " + fact));
    }

}
