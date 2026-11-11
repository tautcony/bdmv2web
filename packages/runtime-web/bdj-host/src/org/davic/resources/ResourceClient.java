package org.davic.resources;

public interface ResourceClient {
    boolean requestRelease(ResourceProxy resource, Object requestData);
    void release(ResourceProxy resource);
    void notifyRelease(ResourceProxy resource);
}
