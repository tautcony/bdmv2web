package javax.media;

import java.io.IOException;
import java.net.URL;

public final class Manager {
    private Manager() { }
    public static Player createPlayer(URL source) throws IOException, NoPlayerException {
        if (source == null) throw new NoPlayerException("A media URL is required.");
        return new BrowserPlayer(source.toExternalForm());
    }
    public static Player createPlayer(MediaLocator source) throws IOException, NoPlayerException {
        if (source == null) throw new NoPlayerException("A media locator is required.");
        return new BrowserPlayer(source.toExternalForm());
    }
}
