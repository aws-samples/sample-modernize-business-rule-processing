package com.rule.test.ruletest.vo;

public class Car {
    private String make;
    private String model;
    private int year;
    private String style;
    private String color;
    private int id;

    public Car() {
    }

    public String getMake() {
        return make;
    }

    public void setMake(String make) {
        this.make = make;
    }

    public String getModel() {
        return model;
    }

    public int getId() {
        return id;
    }

    public void setId(int id) {
        this.id = id;
    }

    @Override
    public String toString() {
        return "Car{" +
                "make='" + make + '\'' +
                ", model='" + model + '\'' +
                ", year=" + year +
                ", style='" + style + '\'' +
                ", color='" + color + '\'' +
                '}';
    }

    public Car(int carid, String make, String model, int year, String style, String color) {
        this.make = make.toLowerCase();
        this.model = model.toLowerCase();
        this.year = year;
        this.style = style.toLowerCase();
        this.color = color.toLowerCase();
        this.id = carid;
    }

    public void setModel(String model) {
        this.model = model;
    }

    public int getYear() {
        return year;
    }

    public void setYear(int year) {
        this.year = year;
    }

    public String getStyle() {
        return style;
    }

    public void setStyle(String style) {
        this.style = style;
    }

    public String getColor() {
        return color;
    }

    public void setColor(String color) {
        this.color = color;
    }
}
