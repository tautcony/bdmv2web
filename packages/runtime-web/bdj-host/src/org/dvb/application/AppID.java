package org.dvb.application;

public final class AppID {
    private final int organizationId; private final int applicationId;
    public AppID(int organizationId, int applicationId) { this.organizationId = organizationId; this.applicationId = applicationId; }
    public int getOID() { return organizationId; }
    public int getAID() { return applicationId; }
}
