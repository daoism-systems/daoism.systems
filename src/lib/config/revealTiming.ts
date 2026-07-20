const STANDARD_HEADING_MOTION = {
	desktop: {
		duration: 0.72,
		stagger: 0.012
	},
	mobile: {
		duration: 0.64,
		stagger: 0.016
	}
} as const;

export const SUPPORTING_UI_REVEAL_PROGRESS = 0.28;

export const HERO_INTRO_PHASE = {
	logo: 1,
	uiGroup: 2,
	menuButtons: 3,
	primaryText: 4,
	secondaryText: 5,
	heading: 6
} as const;

export const HERO_INTRO_PHASE_MOBILE = {
	logo: 1,
	buttons: 2,
	heading: 3,
	primaryText: 4,
	secondaryText: 5,
	scrollIndicator: 6
} as const;

export const HERO_INTRO_DELAY_MS = {
	desktop: {
		uiGroup: 140,
		menuButtons: 240,
		primaryText: 360,
		secondaryText: 470,
		heading: 620
	},
	mobile: {
		buttons: 150,
		heading: 320,
		primaryText: 480,
		secondaryText: 590,
		scrollIndicator: 820
	}
} as const;

export const HERO_UI_TIMING = {
	scrollHoldEnd: 0.54,
	scrollBeats: {
		secondaryText: { start: 0.12, end: 1 },
		heading: { start: 0.05, end: 1 }
	},
	topLineDurationMs: 1050,
	textDuration: 0.58,
	headingMotion: {
		duration: 0.76,
		stagger: 0.014
	},
	unlockBeforeHeadingEnd: 0.16
} as const;

export const ABOUT_UI_TIMING = {
	desktop: {
		window: {
			revealStart: 0.04,
			revealEnd: 0.52,
			hideStart: 0.76,
			hideEnd: 1.16
		},
		beats: {
			heading: { start: 0, end: 0.68 },
			primaryCopy: { start: 0.15, end: 0.82 },
			secondaryCopy: { start: 0.5, end: 1 }
		},
		headingMotion: {
			duration: 0.8,
			stagger: 0.014
		},
		copyDuration: 0.96
	},
	mobile: {
		window: {
			revealStart: 0.04,
			revealEnd: 0.46,
			hideStart: 0.78,
			hideEnd: 1.14
		},
		beats: {
			heading: { start: 0, end: 0.58 },
			primaryCopy: { start: 0.24, end: 0.8 },
			secondaryCopy: { start: 0.48, end: 1 }
		},
		headingMotion: STANDARD_HEADING_MOTION.mobile,
		copyDuration: 0.82
	}
} as const;

export const SERVICES_UI_TIMING = {
	desktop: {
		window: {
			revealStart: 0,
			revealEnd: 0.42,
			hideStart: 0.72,
			hideEnd: 1
		},
		beats: {
			heading: { start: 0, end: 0.66 },
			cards: [
				{ start: 0.26, end: 0.78 },
				{ start: 0.42, end: 0.94 }
			]
		},
		headingMotion: STANDARD_HEADING_MOTION.desktop
	},
	mobile: {
		window: {
			revealStart: 0.02,
			revealEnd: 0.44,
			hideStart: 0.76,
			hideEnd: 1
		},
		beats: {
			heading: { start: 0, end: 0.52 },
			cards: [
				{ start: 0.14, end: 0.76 },
				{ start: 0.24, end: 1 }
			]
		},
		headingMotion: STANDARD_HEADING_MOTION.mobile
	}
} as const;

export const COLLABORATION_UI_TIMING = {
	desktop: {
		window: {
			revealStart: 0,
			revealEnd: 0.44,
			hideStart: 0.76,
			hideEnd: 1.22
		},
		beats: {
			heading: { start: 0, end: 0.64 },
			button: { start: 0.15, end: 0.78 },
			subtitle: { start: 0.6, end: 1 },
			scrimIn: { start: 0, end: 0.32 },
			scrimOut: { start: 1, end: 1.1 }
		},
		headingMotion: STANDARD_HEADING_MOTION.desktop,
		subtitleDuration: 0.82
	},
	mobile: {
		window: {
			revealStart: 0.02,
			revealEnd: 0.48,
			hideStart: 0.78,
			hideEnd: 1.18
		},
		beats: {
			heading: { start: 0, end: 0.56 },
			button: { start: 0.32, end: 0.78 },
			subtitle: { start: 0.36, end: 1 },
			scrimIn: { start: 0, end: 0.32 },
			scrimOut: { start: 1, end: 1.08 }
		},
		headingMotion: STANDARD_HEADING_MOTION.mobile,
		subtitleDuration: 0.72
	},
	phone: {
		window: {
			revealStart: 0.02,
			revealEnd: 0.48,
			hideStart: 0.78,
			hideEnd: 1.18
		},
		beats: {
			heading: { start: 0, end: 0.56 },
			subtitle: { start: 0.23, end: 0.8 },
			button: { start: 0.28, end: 0.8 },
			scrimIn: { start: 0, end: 0.32 },
			scrimOut: { start: 1, end: 1.08 }
		},
		headingMotion: STANDARD_HEADING_MOTION.mobile,
		subtitleDuration: 0.72
	}
} as const;

export const VENTURES_UI_TIMING = {
	desktop: {
		window: {
			revealStart: 0.12,
			revealEnd: 0.32,
			hideStart: 0.86,
			hideEnd: 1.12
		},
		content: { start: 0.25, end: 0.35 },
		descriptionHide: { start: 0.78, end: 1.04 },
		headingMotion: {
			duration: 0.68,
			stagger: 0.012
		},
		copyDuration: 1.2
	},
	mobile: {
		window: {
			revealStart: 0.1,
			revealEnd: 0.34,
			hideStart: 0.86,
			hideEnd: 1.1
		},
		content: { start: 0.3, end: 0.44 },
		descriptionHide: { start: 0.8, end: 1.04 },
		headingMotion: STANDARD_HEADING_MOTION.mobile,
		copyDuration: 0.84
	}
} as const;

export const PARTNERS_UI_TIMING = {
	desktop: {
		window: {
			revealStart: 0.02,
			revealEnd: 0.42,
			hideStart: 0.84,
			hideEnd: 0.98
		},
		beats: {
			heading: { start: 0, end: 0.66 },
			divider: { start: 0.14, end: 0.72 },
			paragraph: { start: 0.15, end: 0.9 },
			cardsReveal: { start: 0.18, end: 0.36 },
			cardsMove: { start: 0.4, end: 0.94 }
		},
		headingMotion: STANDARD_HEADING_MOTION.desktop,
		copyDuration: 1.02,
		cardItems: {
			surface: { start: 0, end: 0.64 },
			number: { start: 0.1, end: 0.72 },
			type: { start: 0.18, end: 0.8 },
			description: { start: 0.28, end: 0.9 },
			icon: { start: 0.4, end: 1 }
		},
		cardsSmoothingMs: 150
	},
	mobile: {
		window: {
			revealStart: 0.02,
			revealEnd: 0.46,
			hideStart: 0.84,
			hideEnd: 0.98
		},
		beats: {
			heading: { start: 0, end: 0.66 },
			divider: { start: 0.14, end: 0.72 },
			paragraph: { start: 0.44, end: 0.9 },
			cardsReveal: { start: 0.15, end: 0.28 },
			cardsMove: { start: 0.4, end: 0.94 }
		},
		headingMotion: STANDARD_HEADING_MOTION.mobile,
		copyDuration: 0.84,
		cardItems: {
			surface: { start: 0, end: 0.68 },
			number: { start: 0.08, end: 0.7 },
			type: { start: 0.14, end: 0.76 },
			description: { start: 0.24, end: 0.88 },
			icon: { start: 0.34, end: 1 }
		},
		cardsSmoothingMs: 135
	}
} as const;

export const TEAM_UI_TIMING = {
	desktop: {
		beats: {
			headingReveal: { start: 0.03, end: 0.24 },
			headingHide: { start: 0.36, end: 0.54 },
			cardsReveal: { start: 0.14, end: 0.3 },
			cardsCycle: { start: 0.34, end: 0.92 }
		},
		headingMotion: STANDARD_HEADING_MOTION.desktop,
		cardItems: {
			surface: { start: 0, end: 0.68 },
			edge: { start: 0.14, end: 0.84 },
			index: { start: 0.12, end: 0.74 },
			title: { start: 0.18, end: 0.82 },
			description: { start: 0.28, end: 0.96 }
		},
		cardsSmoothingMs: 120
	},
	mobile: {
		beats: {
			headingReveal: { start: 0.04, end: 0.24 },
			headingHide: { start: 0.4, end: 0.58 },
			cardsReveal: { start: 0.18, end: 0.34 },
			cardsCycle: { start: 0.4, end: 0.94 }
		},
		headingMotion: STANDARD_HEADING_MOTION.mobile,
		cardItems: {
			surface: { start: 0, end: 0.66 },
			edge: { start: 0.1, end: 0.82 },
			index: { start: 0.1, end: 0.72 },
			title: { start: 0.2, end: 0.84 },
			description: { start: 0.32, end: 1 }
		},
		cardsSmoothingMs: 135
	}
} as const;

export const CONTACT_UI_TIMING = {
	desktop: {
		panelRevealEnd: 0.3,
		revealWindow: 0.42,
		beats: {
			heading: { start: 0.02, end: 0.38 },
			nameField: { start: 0.12, end: 0.5 },
			emailField: { start: 0.18, end: 0.54 },
			lead: { start: 0.28, end: 0.62 },
			message: { start: 0.32, end: 0.68 },
			submit: { start: 0.46, end: 0.76 },
			lynksen: { start: 0.56, end: 0.82 },
			socials: { start: 0.66, end: 0.92 },
			footerPrimary: { start: 0.72, end: 0.96 },
			footerSecondary: { start: 0.78, end: 1 }
		},
		headingMotion: {
			duration: 0.62,
			stagger: 0.03
		},
		footerDuration: 0.68
	},
	mobile: {
		panelRevealEnd: 0.26,
		revealWindow: 0.52,
		beats: {
			heading: { start: 0.02, end: 0.24 },
			lead: { start: 0.12, end: 0.34 },
			lynksen: { start: 0.24, end: 0.42 },
			socials: { start: 0.32, end: 0.5 },
			nameField: { start: 0.42, end: 0.62 },
			emailField: { start: 0.5, end: 0.68 },
			message: { start: 0.58, end: 0.76 },
			submit: { start: 0.68, end: 0.84 },
			footerPrimary: { start: 0.78, end: 0.94 },
			footerSecondary: { start: 0.84, end: 1 }
		},
		headingMotion: {
			duration: 0.54,
			stagger: 0.024
		},
		footerDuration: 0.54
	}
} as const;

export const SECTION_REVEAL_COMPLETE = {
	desktop: {
		about: ABOUT_UI_TIMING.desktop.window.revealEnd,
		services: SERVICES_UI_TIMING.desktop.window.revealEnd,
		collaboration: COLLABORATION_UI_TIMING.desktop.window.revealEnd,
		ventures: VENTURES_UI_TIMING.desktop.window.revealEnd,
		partners: PARTNERS_UI_TIMING.desktop.window.revealEnd,
		team: TEAM_UI_TIMING.desktop.beats.cardsReveal.end,
		contact: CONTACT_UI_TIMING.desktop.revealWindow
	},
	mobile: {
		about: ABOUT_UI_TIMING.mobile.window.revealEnd,
		services: SERVICES_UI_TIMING.mobile.window.revealEnd,
		collaboration: COLLABORATION_UI_TIMING.mobile.window.revealEnd,
		ventures: VENTURES_UI_TIMING.mobile.content.end,
		partners: PARTNERS_UI_TIMING.mobile.window.revealEnd,
		team: TEAM_UI_TIMING.mobile.beats.cardsReveal.end,
		contact: CONTACT_UI_TIMING.mobile.revealWindow
	}
} as const;
