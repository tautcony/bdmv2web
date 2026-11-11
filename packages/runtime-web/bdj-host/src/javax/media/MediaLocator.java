package javax.media;

public class MediaLocator {
    private final String locator;
    public MediaLocator(String locator) { this.locator = locator == null ? "" : locator; }
    public String getProtocol() { int end = locator.indexOf(':'); return end < 0 ? "" : locator.substring(0, end); }
    public String getRemainder() { int start = locator.indexOf(':'); return start < 0 ? locator : locator.substring(start + 1); }
    public String getLocatorString() { return locator; }
    public String toExternalForm() { return locator; }
    public String toString() { return locator; }
}
