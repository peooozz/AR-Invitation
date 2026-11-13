/**
 * AR Invitation Configuration
 * Customize the client name, event details, venue, RSVP, and 3D hero details.
 */
export const INVITATION_CONFIG = {
  // Client & Event Details
  clientName: "Shri Vikramaditya Shinde",
  eventName: "50 Forts Swarajya Expedition Celebration",
  tagline: "Celebrating the triumphant ascent of 50+ historic forts of Chhatrapati Shivaji Maharaj",
  invitationNote: "Cordially invites you and your family to an evening of Maratha heritage, triumph, and celebration.",
  
  // Date & Venue
  date: "Sunday, 28 February 2026",
  time: "6:00 PM IST",
  venue: "The Royal Ballroom, Heritage Palace, Pune, Maharashtra",
  venueAddress: "Heritage Palace, Senapati Bapat Road, Shivajinagar, Pune 411016",
  googleMapsUrl: "https://www.google.com/maps/search/?api=1&query=Shivajinagar+Pune+Maharashtra",
  
  // RSVP Details
  rsvpName: "Vikramaditya & Family",
  rsvpPhone: "+91 98765 43210",
  rsvpEmail: "invitations@swarajyaforts.com",
  rsvpWhatsAppMessage: "Jai Shivray! I would love to confirm my attendance for the 50 Forts Celebration on 28th Feb 2026.",
  
  // Audio & 3D Settings
  defaultAudioLanguage: "en", // 'en' | 'hi' | 'mr'
  heroModelPath: "/models/hero.glb",
  heroAudioPath: "/audio/hero.mp3",
};

/**
 * Hero Monument Data (Client with Chhatrapati Shivaji Maharaj)
 * Displayed when user touches the central Hero 3D model
 */
export const HERO_DATA = {
  id: "hero",
  name: "50 Forts Swarajya Tribute",
  nameMarathi: "५० किल्ले स्वराज्य पदभ्रमण",
  badge: "50+ Killas Conquered",
  subtitle: "Shri Vikramaditya Shinde with Chhatrapati Shivaji Maharaj",
  district: "Sahyadri Range, Maharashtra",
  elevation: "Over 50 Peaks Scaled",
  year: "2026 Celebration",
  history: "Honouring the historic achievement of climbing over 50 hill forts of Chhatrapati Shivaji Maharaj. From the rugged peaks of Torna and Rajgad to the capital at Raigad, an inspiring journey celebrating Maratha valor, endurance, and devotion to Hindavi Swarajya.",
  audioPath: "/audio/hero.mp3",
  modelPath: "/models/hero.glb"
};
