package javax.media;

public class Time {
    private final long nanoseconds;
    public Time(long nanoseconds) { this.nanoseconds = nanoseconds; }
    public Time(double seconds) { this.nanoseconds = (long) (seconds * 1_000_000_000d); }
    public long getNanoseconds() { return nanoseconds; }
    public double getSeconds() { return nanoseconds / 1_000_000_000d; }
    public String toString() { return Double.toString(getSeconds()); }
}
