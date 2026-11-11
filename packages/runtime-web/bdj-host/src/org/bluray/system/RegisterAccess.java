package org.bluray.system;

import com.bdmv2web.bdj.BdjHostBridge;

public final class RegisterAccess {
    private static final RegisterAccess INSTANCE = new RegisterAccess();
    private RegisterAccess() { }
    public static RegisterAccess getInstance() { return INSTANCE; }
    public int getGPR(int index) { return Integer.parseUnsignedInt(BdjHostBridge.call("readGPR", Integer.toString(index))); }
    public int getPSR(int index) { return Integer.parseUnsignedInt(BdjHostBridge.call("readPSR", Integer.toString(index))); }
    public void setGPR(int index, int value) { BdjHostBridge.call("writeGPR", Integer.toString(index), Integer.toUnsignedString(value)); }
}
