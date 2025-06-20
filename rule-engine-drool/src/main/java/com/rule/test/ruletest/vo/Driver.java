package com.rule.test.ruletest.vo;

public class Driver {
    private int age ;
    private String name;
    private int id;

    public int getId() {
        return id;
    }

    public void setId(int id) {
        this.id = id;
    }

    public Driver() {
    }

    public Driver(int id, int age, String name) {
        this.age = age;
        this.name = name;
        this.id = id;
    }

    public int getAge() {
        return age;
    }

    public void setAge(int age) {
        this.age = age;
    }

    public String getName() {
        return name;
    }

    public void setName(String name) {
        this.name = name;
    }

    @Override
    public String toString() {
        return "Driver{" +
                "age=" + age +
                ", name='" + name + '\'' +
                '}';
    }
}
