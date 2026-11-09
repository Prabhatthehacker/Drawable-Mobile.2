# Drawable (phone app)

Describe a picture or choose one, then watch it get drawn: outlines first, then the colors.
Optionally record the drawing as a video, and save the image or the video.

## Files
- `www/index.html`, `www/style.css`, `www/app.js` - the whole app
- `capacitor.config.json`, `package.json` - settings for wrapping the app as an Android app (Capacitor)
- `.github/workflows/build-apk.yml` - builds the APK for you on GitHub

## Get the APK
1. Create a new repository on GitHub and upload ALL of these files, keeping the folders
   (including the `.github` folder). If the web upload skips `.github`, use GitHub Desktop or git instead.
2. Open the repository's **Actions** tab. The build starts by itself after the upload,
   or choose **Build Android APK** then **Run workflow**.
3. When the run shows a green tick, open it and download **Drawable-APK** from the Artifacts list.
4. Unzip it, copy `app-debug.apk` to your phone and open it. Android will ask you to allow installing
   from this source. This is a debug APK (fine for your own phone, not for the Play Store).

## Try it without an APK
Open `www/index.html` in Chrome on a computer or phone.

## Notes
- Making a picture from words uses the free Pollinations online service and needs internet.
  That is the `fetchPicture` function in `www/app.js`; change only that to use another service.
- Saving in the APK uses the Filesystem and Share plugins listed in `package.json`.
