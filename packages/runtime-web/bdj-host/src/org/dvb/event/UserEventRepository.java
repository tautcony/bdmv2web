package org.dvb.event;

import java.util.HashSet;
import java.util.Set;

public final class UserEventRepository {
    private final String name; private final Set<Integer> keys = new HashSet<Integer>();
    public UserEventRepository(String name) { this.name = name; }
    public void addKey(int key) { keys.add(key); }
    public boolean contains(int key) { return keys.contains(key); }
    public void removeKey(int key) { keys.remove(key); }
    public void addAllArrowKeys() { for (int key = 37; key <= 40; key++) addKey(key); }
    public void addAllNumericKeys() { for (int key = 48; key <= 57; key++) addKey(key); }
    public void addAllColourKeys() { for (int key = 403; key <= 406; key++) addKey(key); }
    public String getName() { return name; }
}
