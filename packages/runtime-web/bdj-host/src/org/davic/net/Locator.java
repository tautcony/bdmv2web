package org.davic.net;

public class Locator implements javax.tv.locator.Locator {
    protected final String url;
    public Locator(String url) { this.url = url; }
    public String toExternalForm() { return url; }
    public String toString() { return url; }
    public boolean hasMultipleTransformations() { return false; }
    public int hashCode() { return url.hashCode(); }
    public boolean equals(Object other) { return other instanceof Locator && url.equals(((Locator) other).toExternalForm()); }
}
