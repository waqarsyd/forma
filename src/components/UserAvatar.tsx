import { User } from 'firebase/auth';

interface UserAvatarProps {
  user: User;
}

/**
 * Initials, never a remote photo.
 *
 * This rendered `user.photoURL` in an `<img>` until 2026-09-06, which for anyone
 * signed in with Google is a `lh3.googleusercontent.com` URL. Two things were
 * wrong with that, and the first is why it was found:
 *
 * - **The CSP blocks it.** `img-src` is `'self' data: blob:`, so the request was
 *   refused by the browser and the avatar fell back to these initials anyway —
 *   after logging a Content Security Policy violation on every page that renders
 *   it. The feature had never worked in production; it only looked like it did
 *   because the fallback is silent.
 * - **Fixing it the other way would have been a step backwards.** Widening
 *   `img-src` to allow Google would put a third-party origin back into the
 *   policy and send a request to Google on every page view, telling them when
 *   this user is using Forma. `src/fonts/` exists precisely because the same
 *   argument was made about webfonts: the families were self-hosted so that
 *   `fonts.googleapis.com` and `fonts.gstatic.com` could LEAVE the CSP. Putting
 *   an avatar host back in for a 28px circle is the same trade in reverse.
 *
 * So the photo is gone rather than allowed. `photoURL` is still on the Firebase
 * user object; nothing here reads it, and nothing should without answering the
 * privacy question above.
 */
export default function UserAvatar({ user }: UserAvatarProps) {
  const initials = user.displayName
    ? user.displayName
        .split(' ')
        .map((n) => n[0])
        .join('')
        .substring(0, 2)
        .toUpperCase()
    : user.email
    ? user.email[0].toUpperCase()
    : 'U';

  return (
    <div
      title={user.displayName || user.email || 'Signed in'}
      className="w-7 h-7 rounded-full bg-primary/10 border border-primary/20 text-primary font-bold text-[10px] flex items-center justify-center select-none shadow-sm shrink-0"
    >
      {initials}
    </div>
  );
}
