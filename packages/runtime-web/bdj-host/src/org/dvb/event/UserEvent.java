package org.dvb.event;

public final class UserEvent extends java.util.EventObject {
    private static final long serialVersionUID = 1L;
    public static final int UEF_KEY_EVENT = 1;
    public static final int UET_KEY_PRESSED = java.awt.event.KeyEvent.KEY_PRESSED;
    public static final int UET_KEY_RELEASED = java.awt.event.KeyEvent.KEY_RELEASED;
    private final int family; private final int type; private final int code; private final int modifiers;
    private final long when;
    public UserEvent(Object source, int type, int code, int modifiers) { this(source, UEF_KEY_EVENT, type, code, modifiers, System.currentTimeMillis()); }
    public UserEvent(Object source, int family, int type, int code, int modifiers, long when) {
        super(source); this.family = family; this.type = type; this.code = code; this.modifiers = modifiers; this.when = when;
    }
    public UserEvent(Object source, int family, char keyChar, long when) { this(source, family, java.awt.event.KeyEvent.KEY_TYPED, keyChar, 0, when); }
    public int getFamily() { return family; }
    public int getType() { return type; }
    public int getCode() { return code; }
    public int getModifiers() { return modifiers; }
    public char getKeyChar() { return (char) code; }
    public long getWhen() { return when; }
    public boolean isShiftDown() { return (modifiers & java.awt.event.InputEvent.SHIFT_MASK) != 0; }
    public boolean isControlDown() { return (modifiers & java.awt.event.InputEvent.CTRL_MASK) != 0; }
    public boolean isMetaDown() { return (modifiers & java.awt.event.InputEvent.META_MASK) != 0; }
    public boolean isAltDown() { return (modifiers & java.awt.event.InputEvent.ALT_MASK) != 0; }
}
