package com.bdmv2web.bdj;

import java.util.ArrayList;
import java.util.List;
import javax.tv.xlet.XletContext;

public final class LifecycleState {
    public static int discInitialized;
    public static int discStarted;
    public static int discPaused;
    public static int discDestroyed;
    public static int titleInitialized;
    public static int titleStarted;
    public static int titleDestroyed;
    public static int presentStartRequested;
    public static int presentWasUnstartedAtTitleInit;
    public static int discClassBootCount;
    public static final List<Integer> titleClassBootCounts = new ArrayList<Integer>();
    public static XletContext discContext;
    private LifecycleState() { }
}
