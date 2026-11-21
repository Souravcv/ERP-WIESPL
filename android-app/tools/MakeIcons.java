// Redraws the app's launcher icons and splash screens from the WIESPL logo, at the sizes the files already have.
// Run from android-app/ with the JDK 21 (no other tools needed):
//   D:\Android\jdk21\bin\java tools\MakeIcons.java ..\public\logo.jpeg android\app\src\main\res
// - mipmap-*/ic_launcher.png        white rounded square, logo at 80 %
// - mipmap-*/ic_launcher_round.png  white circle, logo at 60 %
// - mipmap-*/ic_launcher_foreground.png  transparent, logo at 52 % (Android 8+ adaptive icon on a white background,
//                                        kept inside the round mask)
// - drawable*/splash.png            white, logo at 40 % of the shorter side
import javax.imageio.ImageIO;
import java.awt.*;
import java.awt.geom.Ellipse2D;
import java.awt.geom.RoundRectangle2D;
import java.awt.image.BufferedImage;
import java.io.File;

public class MakeIcons {
    public static void main(String[] args) throws Exception {
        BufferedImage logo = trim(ImageIO.read(new File(args[0])));
        File res = new File(args[1]);
        int n = 0;
        for (File dir : res.listFiles(File::isDirectory)) {
            for (File f : dir.listFiles((d, name) -> name.endsWith(".png"))) {
                BufferedImage old = ImageIO.read(f);
                int w = old.getWidth(), h = old.getHeight();
                String name = f.getName();
                BufferedImage out;
                if (name.equals("ic_launcher.png")) out = icon(logo, w, 0.80, false);
                else if (name.equals("ic_launcher_round.png")) out = icon(logo, w, 0.60, true);
                else if (name.equals("ic_launcher_foreground.png")) out = foreground(logo, w, 0.52);
                else if (name.equals("splash.png")) out = splash(logo, w, h, 0.40);
                else continue;
                ImageIO.write(out, "png", f);
                System.out.println(dir.getName() + "/" + name + " " + w + "x" + h);
                n++;
            }
        }
        System.out.println(n + " images written");
    }

    // Cut the white margin around the logo.
    static BufferedImage trim(BufferedImage img) {
        int x0 = img.getWidth(), y0 = img.getHeight(), x1 = -1, y1 = -1;
        for (int y = 0; y < img.getHeight(); y++)
            for (int x = 0; x < img.getWidth(); x++) {
                int p = img.getRGB(x, y);
                if (((p >> 16) & 255) < 235 || ((p >> 8) & 255) < 235 || (p & 255) < 235) {
                    x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y);
                }
            }
        return img.getSubimage(x0, y0, x1 - x0 + 1, y1 - y0 + 1);
    }

    // High-quality resize: halve step by step when shrinking, bicubic for the last step.
    static BufferedImage scale(BufferedImage img, int w, int h) {
        BufferedImage cur = img;
        while (cur.getWidth() / 2 >= w && cur.getHeight() / 2 >= h) cur = draw(cur, cur.getWidth() / 2, cur.getHeight() / 2);
        return draw(cur, w, h);
    }
    static BufferedImage draw(BufferedImage src, int w, int h) {
        BufferedImage out = new BufferedImage(w, h, BufferedImage.TYPE_INT_ARGB);
        Graphics2D g = out.createGraphics();
        hints(g);
        g.drawImage(src, 0, 0, w, h, null);
        g.dispose();
        return out;
    }
    static void hints(Graphics2D g) {
        g.setRenderingHint(RenderingHints.KEY_INTERPOLATION, RenderingHints.VALUE_INTERPOLATION_BICUBIC);
        g.setRenderingHint(RenderingHints.KEY_RENDERING, RenderingHints.VALUE_RENDER_QUALITY);
        g.setRenderingHint(RenderingHints.KEY_ANTIALIASING, RenderingHints.VALUE_ANTIALIAS_ON);
    }

    // The logo fitted into a centred box of `frac` of the width (and height).
    static void place(Graphics2D g, BufferedImage logo, int w, int h, double frac) {
        double k = Math.min(w * frac / logo.getWidth(), h * frac / logo.getHeight());
        int lw = (int) Math.round(logo.getWidth() * k), lh = (int) Math.round(logo.getHeight() * k);
        g.drawImage(scale(logo, lw, lh), (w - lw) / 2, (h - lh) / 2, null);
    }

    static BufferedImage icon(BufferedImage logo, int s, double frac, boolean round) {
        BufferedImage out = new BufferedImage(s, s, BufferedImage.TYPE_INT_ARGB);
        Graphics2D g = out.createGraphics();
        hints(g);
        Shape shape = round ? new Ellipse2D.Double(0, 0, s, s) : new RoundRectangle2D.Double(0, 0, s, s, s * 0.36, s * 0.36);
        g.setColor(Color.WHITE);
        g.fill(shape);
        g.setClip(shape);
        place(g, logo, s, s, frac);
        g.dispose();
        return out;
    }

    static BufferedImage foreground(BufferedImage logo, int s, double frac) {
        BufferedImage out = new BufferedImage(s, s, BufferedImage.TYPE_INT_ARGB);
        Graphics2D g = out.createGraphics();
        hints(g);
        place(g, logo, s, s, frac);
        g.dispose();
        return out;
    }

    static BufferedImage splash(BufferedImage logo, int w, int h, double frac) {
        BufferedImage out = new BufferedImage(w, h, BufferedImage.TYPE_INT_RGB);
        Graphics2D g = out.createGraphics();
        hints(g);
        g.setColor(Color.WHITE);
        g.fillRect(0, 0, w, h);
        int m = Math.min(w, h);
        double k = m * frac / Math.max(logo.getWidth(), logo.getHeight());
        int lw = (int) Math.round(logo.getWidth() * k), lh = (int) Math.round(logo.getHeight() * k);
        g.drawImage(scale(logo, lw, lh), (w - lw) / 2, (h - lh) / 2, null);
        g.dispose();
        return out;
    }
}
