package com.bdmv2web.bdj;

import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Set;
import javax.tv.xlet.Xlet;
import javax.tv.xlet.XletContext;
import javax.tv.xlet.XletStateChangeException;
import org.dvb.application.AppID;
import org.dvb.application.AppProxy;
import org.dvb.application.AppsDatabase;

/** Implements the BDJO control-code lifecycle for the selected Java applications. */
public final class BdjApplicationManager {
    public interface EventSink { void send(String name, String value); }
    public static final class Application {
        public String bdjoId;
        private final Set<String> bdjoIds = new HashSet<String>();
        public final int controlCode;
        public final int binding;
        public final int organizationId;
        public final int applicationId;
        public final String initialClass;
        public final String basePath;
        public final String classPath;
        public final String[] parameters;
        Xlet xlet;
        private XletContext context;
        private boolean initialized;
        private boolean started;
        private boolean paused;
        private boolean destroyed;
        private boolean registered;
        private BdjApplicationClassLoader classLoader;

        public Application(String bdjoId, int controlCode, int binding, int organizationId, int applicationId, String initialClass, String basePath, String classPath, String[] parameters) {
            this.bdjoId = bdjoId; this.bdjoIds.add(bdjoId); this.controlCode = controlCode; this.binding = binding; this.organizationId = organizationId; this.applicationId = applicationId;
            this.initialClass = initialClass; this.basePath = basePath; this.classPath = classPath; this.parameters = parameters;
        }
    }

    private final List<Application> applications = new ArrayList<Application>();
    private String activeBdjoId;
    private int activeTitle = 0xffff;
    private EventSink eventSink = (name, value) -> { };

    public void setEventSink(EventSink sink) { eventSink = sink == null ? (name, value) -> { } : sink; }
    public synchronized void add(Application application) {
        for (Application existing : applications) {
            if (existing.organizationId == application.organizationId && existing.applicationId == application.applicationId
                && existing.initialClass.equals(application.initialClass) && existing.basePath.equals(application.basePath)) {
                existing.bdjoIds.add(application.bdjoId);
                return;
            }
        }
        applications.add(application);
    }

    private boolean belongsToActiveBdjo(Application application) { return application.bdjoIds.contains(activeBdjoId); }

    public synchronized void activate(String bdjoId, int title) throws Exception {
        activate(bdjoId, title, false);
    }

    public synchronized void activate(String bdjoId, int title, boolean restart) throws Exception {
        if (bdjoId == null || !bdjoId.matches("\\d{5}")) throw new IllegalArgumentException("Invalid BDJO identifier " + bdjoId);
        BdjHostBridge.trace("com.bdmv2web.bdj.BdjApplicationManager", "activate", "begin",
            "fromBdjo=" + activeBdjoId + " fromTitle=" + activeTitle + " toBdjo=" + bdjoId + " toTitle=" + title + " restart=" + restart);
        if (bdjoId.equals(activeBdjoId)) {
            changeTitle(title, restart);
            BdjHostBridge.trace("com.bdmv2web.bdj.BdjApplicationManager", "activate", "complete", "bdjo=" + activeBdjoId + " title=" + activeTitle);
            return;
        }
        for (Application application : applications) {
            boolean remainsInBdjo = application.bdjoIds.contains(bdjoId);
            if (application.initialized && (!remainsInBdjo || (restart && isTitleBound(application)))) destroyApplication(application);
        }
        activeBdjoId = bdjoId;
        activeTitle = title;
        for (Application application : applications) {
            if (!belongsToActiveBdjo(application) || (application.controlCode != 1 && application.controlCode != 2)) continue;
            application.bdjoId = bdjoId;
            if (application.context instanceof BdjXletContext) ((BdjXletContext) application.context).setActiveBdjo(bdjoId);
            if (!application.initialized) initializeApplication(application);
        }
        startApplicationsForTitle(title, restart);
        BdjHostBridge.trace("com.bdmv2web.bdj.BdjApplicationManager", "activate", "complete", "bdjo=" + activeBdjoId + " title=" + activeTitle);
    }

    private void start(Application application) throws XletStateChangeException {
        if (!application.initialized || application.started) {
            BdjHostBridge.trace(application.initialClass, "AppProxy.start", "no-op",
                "applicationId=" + application.applicationId + " controlCode=" + application.controlCode
                    + " binding=" + application.binding + " initialized=" + application.initialized
                    + " started=" + application.started + " paused=" + application.paused
                    + " activeBdjo=" + activeBdjoId + " activeTitle=" + activeTitle);
            return;
        }
        Thread thread = Thread.currentThread(); ClassLoader previous = thread.getContextClassLoader();
        try {
            if (application.classLoader != null) thread.setContextClassLoader(application.classLoader);
            BdjHostBridge.trace(application.initialClass, "startXlet", "", "applicationId=" + application.applicationId + " bdjo=" + activeBdjoId + " classLoader=" + System.identityHashCode(application.classLoader));
            application.xlet.startXlet();
            application.started = true;
            application.paused = false;
            application.destroyed = false;
        } finally { thread.setContextClassLoader(previous); }
    }

    private void changeTitle(int title, boolean restart) throws Exception {
        BdjHostBridge.trace("com.bdmv2web.bdj.BdjApplicationManager", "changeTitle", "begin", "from=" + activeTitle + " to=" + title + " restart=" + restart);
        if (title == activeTitle && !restart) return;
        for (Application application : applications) {
            if (belongsToActiveBdjo(application) && restart && isTitleBound(application)) destroyApplication(application);
        }
        activeTitle = title;
        startApplicationsForTitle(title, restart);
        BdjHostBridge.trace("com.bdmv2web.bdj.BdjApplicationManager", "changeTitle", "complete", "title=" + activeTitle);
    }

    private void startApplicationsForTitle(int title, boolean restart) throws Exception {
        for (Application application : applications) {
            if (!belongsToActiveBdjo(application)) continue;
            boolean autostart = application.controlCode == 1;
            BdjHostBridge.trace(application.initialClass, "controlCode", "dispatch",
                "applicationId=" + application.applicationId + " controlCode=" + application.controlCode
                    + " binding=" + application.binding + " title=" + title + " restart=" + restart
                    + " operation=" + (autostart ? "start" : "retain")
                    + " initialized=" + application.initialized + " started=" + application.started);
            if (autostart) {
                if (!application.initialized) initializeApplication(application);
                start(application);
            }
        }
    }

    private void initializeApplication(Application application) throws Exception {
        application.destroyed = false;
        Thread thread = Thread.currentThread(); ClassLoader previous = thread.getContextClassLoader();
        try {
            application.classLoader = new BdjApplicationClassLoader(application);
            thread.setContextClassLoader(application.classLoader);
            Class<?> type = Class.forName(application.initialClass, true, application.classLoader);
            Object instance = type.getDeclaredConstructor().newInstance();
            if (!(instance instanceof Xlet)) throw new IllegalStateException(application.initialClass + " does not implement javax.tv.xlet.Xlet.");
            application.xlet = (Xlet) instance;
            application.context = new BdjXletContext(application, this);
            BdjHostBridge.trace(application.initialClass, "initXlet", "", "bdjo=" + application.bdjoId + " control=" + application.controlCode + " binding=" + application.binding + " classLoader=" + System.identityHashCode(application.classLoader));
            application.xlet.initXlet(application.context);
            application.initialized = true;
            AppsDatabase.getAppsDatabase().register(new AppID(application.organizationId, application.applicationId), new AppProxy() {
                public int getState() { return application.started ? STARTED : application.paused ? PAUSED : application.destroyed ? DESTROYED : NOT_LOADED; }
                public void start() { try { BdjApplicationManager.this.start(application); } catch (XletStateChangeException error) { throw new IllegalStateException(error); } }
                public void pause() { BdjApplicationManager.this.pause(application); }
                public void resume() { try { BdjApplicationManager.this.resume(application); } catch (XletStateChangeException error) { throw new IllegalStateException(error); } }
            });
            application.registered = true;
        } catch (Exception | Error error) {
            destroyApplication(application);
            throw error;
        } finally { thread.setContextClassLoader(previous); }
    }

    private void destroyApplications() {
        for (Application application : applications) destroyApplication(application);
    }

    private void destroyApplication(Application application) {
        if (application.destroyed) return;
        Thread thread = Thread.currentThread(); ClassLoader previous = thread.getContextClassLoader();
        try {
            if (application.classLoader != null) thread.setContextClassLoader(application.classLoader);
            if (application.xlet != null) {
                BdjHostBridge.trace(application.initialClass, "destroyXlet", "", "bdjo=" + application.bdjoId + " unconditional=true classLoader=" + System.identityHashCode(application.classLoader));
                application.xlet.destroyXlet(true);
            }
        }
        catch (Throwable error) { BdjHostBridge.trace(application.initialClass, "destroyXlet", "error", error.toString()); }
        finally { thread.setContextClassLoader(previous); }
        try { if (application.context != null) org.dvb.io.ixc.IxcRegistry.unbindAll(application.context); }
        catch (Throwable error) { BdjHostBridge.trace(application.initialClass, "IxcRegistry.unbindAll", "error", error.toString()); }
        try { if (application.registered) AppsDatabase.getAppsDatabase().unregister(new AppID(application.organizationId, application.applicationId)); }
        catch (Throwable error) { BdjHostBridge.trace(application.initialClass, "AppsDatabase.unregister", "error", error.toString()); }
        finally { application.registered = false; }
        BdjApplicationClassLoader classLoader = application.classLoader;
        application.initialized = false; application.started = false; application.xlet = null; application.context = null; application.destroyed = true;
        application.paused = false; application.classLoader = null;
        if (classLoader != null) try { classLoader.close(); } catch (Exception error) { BdjHostBridge.trace(application.initialClass, "classLoader.close", "error", error.toString()); }
    }

    public void dispatchInput(int keyCode, int modifiers, int eventType) {
        BdjHostBridge.trace("com.bdmv2web.bdj.BdjApplicationManager", "dispatchInput", "key",
            "keyCode=" + keyCode + " modifiers=" + modifiers + " eventType=" + eventType);
        org.havi.ui.HScene.dispatchRemoteKey(keyCode, modifiers, eventType);
        org.dvb.event.EventManager.getInstance().dispatch(keyCode, modifiers, eventType);
    }
    public void dispatchPointer(int x, int y) { org.havi.ui.HScene.dispatchRemotePointer(x, y); }
    public synchronized void shutdown() { destroyApplications(); }
    public synchronized void dispatchTitle(String bdjoId, int title, boolean started) {
        dispatchTitle(bdjoId, title, started, false);
    }
    public synchronized void dispatchTitle(String bdjoId, int title, boolean started, boolean restart) {
        BdjHostBridge.trace("com.bdmv2web.bdj.BdjApplicationManager", "dispatchTitle", "received",
            "activeBdjo=" + activeBdjoId + " activeTitle=" + activeTitle + " bdjo=" + bdjoId + " title=" + title + " started=" + started + " restart=" + restart);
        boolean dispatched = false;
        try {
            if (started) { activate(bdjoId, title, restart); dispatched = true; }
            else if (bdjoId.equals(activeBdjoId)) { changeTitle(0xffff, restart); dispatched = true; }
        } catch (Throwable error) { BdjHostBridge.trace("runtime", "title", "error", error.toString()); }
        BdjHostBridge.trace("com.bdmv2web.bdj.BdjApplicationManager", "dispatchTitle", "complete",
            "activeBdjo=" + activeBdjoId + " activeTitle=" + activeTitle + " bdjo=" + bdjoId + " title=" + title + " started=" + started + " restart=" + restart);
        if (dispatched) eventSink.send(started ? "title-start" : "title-stop", Integer.toString(title));
    }
    synchronized void notifyDestroyed(Application application) { destroyApplication(application); eventSink.send("application-destroyed", applicationId(application)); }
    synchronized void notifyPaused(Application application) {
        if (application.paused) return;
        application.started = false; application.paused = true; eventSink.send("application-paused", applicationId(application));
    }
    synchronized void pause(Application application) {
        if (!application.initialized || !application.started) return;
        Thread thread = Thread.currentThread(); ClassLoader previous = thread.getContextClassLoader();
        try {
            if (application.classLoader != null) thread.setContextClassLoader(application.classLoader);
            BdjHostBridge.trace(application.initialClass, "pauseXlet", "", "applicationId=" + application.applicationId + " bdjo=" + activeBdjoId);
            application.xlet.pauseXlet(); application.started = false; application.paused = true;
            eventSink.send("application-paused", applicationId(application));
        } catch (Throwable error) { BdjHostBridge.trace(application.initialClass, "pauseXlet", "error", error.toString()); }
        finally { thread.setContextClassLoader(previous); }
    }
    synchronized void resume(Application application) throws XletStateChangeException {
        if (!application.initialized || !application.paused) { start(application); return; }
        start(application);
        eventSink.send("application-resumed", applicationId(application));
    }
    private static String applicationId(Application application) { return String.format("%08x:%04x", application.organizationId, application.applicationId); }
    private static boolean isTitleBound(Application application) { return (application.binding & 2) != 0; }
}
