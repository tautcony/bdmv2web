package org.havi.ui;

import java.util.HashMap;
import java.util.Map;

public class HSceneTemplate {
    private final Map<Integer, Object> preferences = new HashMap<Integer, Object>();
    public void setPreference(int key, Object value, int priority) { preferences.put(key, value); }
    public Object getPreference(int key) { return preferences.get(key); }
}
