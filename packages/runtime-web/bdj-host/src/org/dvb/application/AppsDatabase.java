package org.dvb.application;

import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ConcurrentMap;

public class AppsDatabase {
    private static final AppsDatabase INSTANCE = new AppsDatabase();
    private final ConcurrentMap<String, AppProxy> applications = new ConcurrentHashMap<String, AppProxy>();
    public AppsDatabase() { }
    public org.dvb.application.AppProxy getAppProxy(org.dvb.application.AppID id) { return applications.get(key(id)); }
    public static org.dvb.application.AppsDatabase getAppsDatabase() { return INSTANCE; }
    public void register(AppID id, AppProxy proxy) { applications.put(key(id), proxy); }
    public void unregister(AppID id) { applications.remove(key(id)); }
    private static String key(AppID id) { return id.getOID() + ":" + id.getAID(); }
}
