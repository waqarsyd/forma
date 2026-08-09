import { useState } from 'react';
import { User } from 'firebase/auth';

interface UserAvatarProps {
  user: User;
}

export default function UserAvatar({ user }: UserAvatarProps) {
  const [imgError, setImgError] = useState(false);

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

  if (user.photoURL && !imgError) {
    return (
      <img
        src={user.photoURL}
        alt={user.displayName || 'User'}
        onError={() => setImgError(true)}
        className="w-7 h-7 rounded-full object-cover border border-outline-variant shadow-sm shrink-0"
      />
    );
  }

  return (
    <div className="w-7 h-7 rounded-full bg-primary/10 border border-primary/20 text-primary font-bold text-[10px] flex items-center justify-center select-none shadow-sm shrink-0">
      {initials}
    </div>
  );
}
