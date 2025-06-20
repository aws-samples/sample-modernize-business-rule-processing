package com.rule.test.ruletest.vo;

public class Policy {

    private String id;
    private double premium;

    public Policy() {
    }

    public String getId() {
        return id;
    }

    public void setId(String id) {
        this.id = id;
    }

    public double getPremium() {
        return premium;
    }

    public Policy(String id, double premium) {
        this.id = id;
        this.premium = premium;
    }

    public void setPremium(double premium) {
        System.out.println("Premium set to== "+premium);
        this.premium = premium;
    }

    @Override
    public String toString() {
        return "Policy{" +
                "id=" + this.id +
                ", premium=" + this.premium +
                '}';
    }
}
