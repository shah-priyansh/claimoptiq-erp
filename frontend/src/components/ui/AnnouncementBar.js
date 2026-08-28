import React, { useEffect, useState } from 'react';
import { HiOutlineSpeakerphone } from 'react-icons/hi';
import { getPublicStatsAPI } from '../../services/api';

/**
 * Scrolling news / announcement ticker (blue bar, white text). The text is
 * managed from Settings → Login Page → Announcement Bar and stored under the
 * `announcement_text` site setting. Renders nothing when the setting is empty.
 *
 * Self-fetches the setting so it can be dropped into any page without threading
 * props. The backend caches public settings for 5 minutes, so repeated mounts
 * across pages are cheap. The marquee animation is defined in a scoped <style>
 * block so it works without any Tailwind config changes.
 */
const AnnouncementBar = ({ className = '' }) => {
  const [text, setText] = useState('');

  useEffect(() => {
    let active = true;
    getPublicStatsAPI()
      .then(({ data }) => { if (active) setText((data?.announcement_text || '').trim()); })
      .catch(() => {});
    return () => { active = false; };
  }, []);

  if (!text) return null;

  // The track holds the text twice; translating it -50% loops seamlessly.
  const Item = () => (
    <span className="mx-8 inline-flex items-center gap-2 text-sm font-medium">
      <HiOutlineSpeakerphone className="w-4 h-4 flex-shrink-0" />
      {text}
    </span>
  );

  return (
    <div className={`ao-marquee relative overflow-hidden rounded-xl bg-primary-600 text-white shadow-sm ${className}`}>
      <style>{`
        @keyframes ao-marquee-scroll { 0% { transform: translateX(0); } 100% { transform: translateX(-50%); } }
        .ao-marquee-track { animation: ao-marquee-scroll 30s linear infinite; }
        .ao-marquee:hover .ao-marquee-track { animation-play-state: paused; }
      `}</style>
      <div className="ao-marquee-track flex whitespace-nowrap py-2">
        <div className="flex flex-shrink-0"><Item /><Item /><Item /></div>
        <div className="flex flex-shrink-0" aria-hidden="true"><Item /><Item /><Item /></div>
      </div>
    </div>
  );
};

export default AnnouncementBar;
