package com.rule.test.ruletest.vo;

import java.math.BigDecimal;

public class InsuranceRequest {


    private double premium;
    private String color;
    private int driverid;
    private String policyid;
    private int year;
    private String name;
    private String model;
    private String style;
    private String make;
    private int age;
    private int carid;



    public InsuranceRequest() {
    }

    public double getPremium() {
        return premium;
    }

    public void setPremium(double premium) {
        this.premium = premium;
    }

    public String getColor() {
        return color;
    }

    public void setColor(String color) {
        this.color = color;
    }

    public int getYear() {
        return year;
    }

    public void setYear(int year) {
        this.year = year;
    }

    public String getName() {
        return name;
    }

    public void setName(String name) {
        this.name = name;
    }

    public String getModel() {
        return model;
    }

    public void setModel(String model) {
        this.model = model;
    }

    public String getStyle() {
        return style;
    }

    public void setStyle(String style) {
        this.style = style;
    }

    public String getMake() {
        return make;
    }

    public void setMake(String make) {
        this.make = make;
    }

    public int getAge() {
        return age;
    }

    public void setAge(int age) {
        this.age = age;
    }

    public int getDriverid() {
        return driverid;
    }

    public void setDriverid(int driverid) {
        this.driverid = driverid;
    }

    public String getPolicyid() {
        return policyid;
    }

    public void setPolicyid(String policyid) {
        this.policyid = policyid;
    }

    public int getCarid() {
        return carid;
    }

    public void setCarid(int carid) {
        this.carid = carid;
    }

    @Override
    public String toString() {
        return "InsuranceRequest{" +
                "premium=" + premium +
                ", color='" + color + '\'' +
                ", driverId=" + driverid +
                ", policyId='" + policyid + '\'' +
                ", year=" + year +
                ", name='" + name + '\'' +
                ", model='" + model + '\'' +
                ", style='" + style + '\'' +
                ", make='" + make + '\'' +
                ", age=" + age +
                ", carId=" + carid +
                '}';
    }
}
