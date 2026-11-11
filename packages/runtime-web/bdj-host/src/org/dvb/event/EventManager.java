package org.dvb.event;

import java.util.concurrent.CopyOnWriteArrayList;

public final class EventManager {
    private static final EventManager INSTANCE = new EventManager();
    private final CopyOnWriteArrayList<Registration> registrations = new CopyOnWriteArrayList<Registration>();
    private EventManager() { }
    public static EventManager getInstance() { return INSTANCE; }
    public void addUserEventListener(UserEventListener listener, UserEventRepository repository) { registrations.add(new Registration(listener, repository)); }
    public void removeUserEventListener(UserEventListener listener) { registrations.removeIf(registration -> registration.listener == listener); }
    public void dispatch(int key, int modifiers) { dispatch(key, modifiers, java.awt.event.KeyEvent.KEY_PRESSED); }
    public void dispatch(int key, int modifiers, int eventType) {
        UserEvent event = new UserEvent(this, eventType, key, modifiers);
        int delivered = 0;
        for (Registration registration : registrations) if (registration.repository.contains(key)) {
            com.bdmv2web.bdj.BdjHostBridge.trace("org.dvb.event.EventManager", "dispatch", "listener",
                "key=" + key + " type=" + eventType + " repository=" + registration.repository.getName()
                    + " listener=" + registration.listener.getClass().getName());
            registration.listener.userEventReceived(event);
            delivered++;
        }
        com.bdmv2web.bdj.BdjHostBridge.trace("org.dvb.event.EventManager", "dispatch", "complete",
            "key=" + key + " type=" + eventType + " registrations=" + registrations.size() + " delivered=" + delivered);
    }
    private static final class Registration {
        final UserEventListener listener; final UserEventRepository repository;
        Registration(UserEventListener listener, UserEventRepository repository) { this.listener = listener; this.repository = repository; }
    }
}
