package org.bluray.net;

import java.util.Locale;

public class BDLocator extends org.davic.net.Locator {
    private final String externalForm;
    private final int playListId;
    private final int titleNumber;
    private final int chapterNumber;

    public BDLocator(String value) {
        super(value == null ? "" : value);
        externalForm = value == null ? "" : value;
        playListId = parsePlaylist(externalForm);
        titleNumber = parseTitle(externalForm);
        chapterNumber = -1;
    }

    public BDLocator(String discId, int titleNumber, int chapterNumber, int playListId) {
        super("bd://" + (discId == null ? "" : discId));
        this.titleNumber = titleNumber;
        this.chapterNumber = chapterNumber;
        this.playListId = playListId;
        if (playListId >= 0) externalForm = "bd://PLAYLIST:" + String.format(Locale.ROOT, "%05d", playListId);
        else if (titleNumber >= 0) externalForm = "bd://TITLE:" + String.format(Locale.ROOT, "%05d", titleNumber);
        else externalForm = "bd://";
    }

    public int getPlayListId() { return playListId; }
    public int getTitleNumber() { return titleNumber; }
    public int getChapterNumber() { return chapterNumber; }
    public String toExternalForm() { return externalForm; }
    public String toString() { return externalForm; }

    private static int parsePlaylist(String value) {
        String upper = value.toUpperCase(Locale.ROOT);
        int marker = upper.indexOf("PLAYLIST:");
        if (marker < 0) return -1;
        int start = marker + "PLAYLIST:".length();
        int end = start;
        while (end < value.length() && Character.isDigit(value.charAt(end))) end++;
        if (end == start) return -1;
        try { return Integer.parseInt(value.substring(start, end)); }
        catch (NumberFormatException ignored) { return -1; }
    }

    private static int parseTitle(String value) {
        if (value.regionMatches(true, 0, "bd://TITLE:", 0, 11)) {
            try { return Integer.parseInt(value.substring(11)); }
            catch (NumberFormatException ignored) { return -1; }
        }
        int separator = value.lastIndexOf('.');
        if (separator < 0 || separator == value.length() - 1) return -1;
        try { return Integer.parseInt(value.substring(separator + 1), 16); }
        catch (NumberFormatException ignored) { return -1; }
    }
}
