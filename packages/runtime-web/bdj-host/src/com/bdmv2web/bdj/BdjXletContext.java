package com.bdmv2web.bdj;

import java.util.HashMap;
import java.util.Map;
import javax.tv.xlet.XletContext;

final class BdjXletContext implements XletContext {
    private final BdjApplicationManager.Application application;
    private final BdjApplicationManager manager;
    private final Map<String, Object> properties = new HashMap<String, Object>();
    BdjXletContext(BdjApplicationManager.Application application, BdjApplicationManager manager) {
        this.application = application; this.manager = manager;
        properties.put("dvb.org.id", String.format("%08x", application.organizationId));
        properties.put("dvb.app.id", String.format("%04x", application.applicationId));
        properties.put("bluray.vfs.root", System.getProperty("bluray.vfs.root", "/bdj"));
        properties.put("bluray.bdjo.id", application.bdjoId);
        properties.put("bluray.disc.id", BdjHostBridge.call("discId"));
        properties.put("dvb.app.parameters", application.parameters.clone());
        properties.put(ARGS, application.parameters.clone());
    }
    public Object getXletProperty(String key) { return properties.get(key); }
    void setActiveBdjo(String bdjoId) { properties.put("bluray.bdjo.id", bdjoId); }
    public void notifyDestroyed() { manager.notifyDestroyed(application); }
    public void notifyPaused() { manager.notifyPaused(application); }
    public void resumeRequest() { try { manager.resume(application); } catch (Exception error) { throw new IllegalStateException(error); } }
    public ClassLoader getClassLoader() { return application.xlet.getClass().getClassLoader(); }
}
