package org.dvb.test;

public class DVBTest {
    public DVBTest() { }
    public static void log(String message, int level) {
        StackTraceElement caller = new Throwable().getStackTrace()[1];
        com.bdmv2web.bdj.BdjHostBridge.trace(caller.getClassName(), caller.getMethodName(),
            caller.getLineNumber() < 0 ? "unknown" : Integer.toString(caller.getLineNumber()),
            "DVBTest " + level + ": " + message);
    }
}
