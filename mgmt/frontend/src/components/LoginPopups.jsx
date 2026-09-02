import { useEffect, useState } from 'react';
import { api } from '../api.js';
import Modal from './Modal.jsx';
import { driveImageUrl, driveImgOnError } from '../driveUrl.js';

export default function LoginPopups() {
  const [popups, setPopups] = useState(null);
  const [popupIndex, setPopupIndex] = useState(0);
  const [slideIndex, setSlideIndex] = useState(0);

  useEffect(() => {
    api.getActivePopups().then(setPopups).catch(() => setPopups([]));
  }, []);

  if (!popups || popups.length === 0 || popupIndex >= popups.length) return null;

  const popup = popups[popupIndex];
  const slide = popup.slides[slideIndex];
  const isLastSlide = slideIndex === popup.slides.length - 1;
  const isLastPopup = popupIndex === popups.length - 1;

  const goNextPopup = () => {
    if (isLastPopup) {
      setPopups([]); // done — closes for good this session
    } else {
      setPopupIndex(i => i + 1);
      setSlideIndex(0);
    }
  };

  const next = () => {
    if (!isLastSlide) setSlideIndex(i => i + 1);
    else goNextPopup();
  };

  return (
    <Modal open={true} onClose={goNextPopup}>
      <div style={{ textAlign: 'center' }}>
        {slide.image_url && (
          <img
            src={driveImageUrl(slide.image_url)}
            alt=""
            style={{ maxWidth: '100%', maxHeight: 320, borderRadius: 10, marginBottom: 15 }}
            // If lh3 fails, first try the thumbnail endpoint; only hide the image
            // if both fail — there's no point showing every user a broken icon at
            // login.
            onError={(e) => {
              const img = e.currentTarget;
              if (img.dataset.driveFallbackTried !== '1') {
                driveImgOnError(slide.image_url)(e);
                if (img.dataset.driveFallbackTried === '1') return;
              }
              img.style.display = 'none';
            }}
          />
        )}
        {slide.text && (
          <p style={{ fontSize: '0.95rem', whiteSpace: 'pre-wrap', marginBottom: 12 }}>{slide.text}</p>
        )}
        {slide.link_url && (
          <a
            href={slide.link_url}
            target="_blank"
            rel="noreferrer"
            style={{ display: 'inline-block', color: 'var(--primary-saffron)', fontWeight: 600, marginBottom: 15, textDecoration: 'underline' }}
          >
            {slide.link_text || slide.link_url}
          </a>
        )}

        {popup.slides.length > 1 && (
          <div style={{ display: 'flex', justifyContent: 'center', gap: 6, margin: '10px 0' }}>
            {popup.slides.map((_, i) => (
              <span
                key={i}
                style={{
                  width: 8, height: 8, borderRadius: '50%',
                  background: i === slideIndex ? 'var(--primary-saffron)' : '#e5e7eb',
                }}
              />
            ))}
          </div>
        )}

        <div style={{ display: 'flex', gap: 10, justifyContent: 'center', marginTop: 15 }}>
          <button type="button" className="btn-submit" style={{ width: 'auto', background: '#e5e7eb', color: '#111' }} onClick={goNextPopup}>
            Skip
          </button>
          <button className="btn-submit" style={{ width: 'auto' }} onClick={next}>
            {isLastSlide ? (isLastPopup ? 'Done' : 'Next Announcement') : 'Next'}
          </button>
        </div>
      </div>
    </Modal>
  );
}
