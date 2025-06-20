package com.rule.test.ruletest.vo;

public class InsuranceResponse {
    private double premium;
    private String carcolor;
    private int driverId;
    private String policyId;
    private int makeyear;
    private String drivername;
    private String carmodel;
    private String carstyle;
    private String carmake;
    private int driverage;
    private int carId;

    public double getPremium() {
        return premium;
    }

    public void setPremium(double premium) {
        this.premium = premium;
    }

    public String getCarcolor() {
        return carcolor;
    }

    public void setCarcolor(String color) {
        this.carcolor = color;
    }

    public int getDriverId() {
        return driverId;
    }

    public void setDriverId(int driverId) {
        this.driverId = driverId;
    }

    public String getPolicyId() {
        return policyId;
    }

    public void setPolicyId(String policyId) {
        this.policyId = policyId;
    }

    public int getMakeyear() {
        return makeyear;
    }

    public void setMakeyear(int year) {
        this.makeyear = year;
    }

    public String getDrivername() {
        return drivername;
    }

    public void setDrivername(String name) {
        this.drivername = name;
    }

    public String getCarmodel() {
        return carmodel;
    }

    public void setCarmodel(String model) {
        this.carmodel = model;
    }

    public String getCarstyle() {
        return carstyle;
    }

    public void setCarstyle(String style) {
        this.carstyle = style;
    }

    public String getCarmake() {
        return carmake;
    }

    public void setCarmake(String make) {
        this.carmake = make;
    }

    public int getDriverage() {
        return driverage;
    }

    public void setDriverage(int age) {
        this.driverage = age;
    }

    public int getCarId() {
        return carId;
    }

    public void setCarId(int carId) {
        this.carId = carId;
    }

    public InsuranceResponse(double premium, String color,
                             int driverId, String policyId,
                             int year, String name, String model,
                             String style, String make, int age, int carId) {
        this.premium = premium;
        this.carcolor = color;
        this.driverId = driverId;
        this.policyId = policyId;
        this.makeyear = year;
        this.drivername = name;
        this.carmodel = model;
        this.carstyle = style;
        this.carmake = make;
        this.driverage = age;
        this.carId = carId;
    }
}
