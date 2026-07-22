function revealBeat(start: number, progressSpan: number) {
	return { start, end: start + progressSpan } as const;
}

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
		heading: revealBeat(0.05, 0.95),
		secondaryText: revealBeat(0.12, 0.88)
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
			heading: revealBeat(0, 0.68),
			primaryCopy: revealBeat(0.18, 0.56),
			secondaryCopy: revealBeat(0.49, 0.4)
		},
		headingMotion: {
			duration: 0.8,
			stagger: 0.014
		},
		copyDuration: 0.96
	},
	mobile: {
		window: {
			revealStart: 0.02,
			revealEnd: 0.66,
			hideStart: 0.78,
			hideEnd: 1.26
		},
		beats: {
			heading: revealBeat(0, 0.74),
			primaryCopy: revealBeat(0.24, 0.72),
			secondaryCopy: revealBeat(0.42, 0.66)
		},
		headingMotion: {
			duration: 0.9,
			stagger: 0.024
		},
		copyDuration: 0.98
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
			heading: revealBeat(0, 0.66),
			cards: [revealBeat(0.26, 0.52), revealBeat(0.42, 0.42)]
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
			heading: revealBeat(0, 0.52),
			cards: [revealBeat(0.14, 0.5), revealBeat(0.24, 0.42)]
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
			heading: revealBeat(0, 0.64),
			button: revealBeat(0.15, 0.52),
			subtitle: revealBeat(0.6, 0.36),
			scrimIn: revealBeat(0, 0.32),
			scrimOut: revealBeat(1, 0.1)
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
			heading: revealBeat(0, 0.56),
			button: revealBeat(0.32, 0.44),
			subtitle: revealBeat(0.36, 0.34),
			scrimIn: revealBeat(0, 0.32),
			scrimOut: revealBeat(1, 0.08)
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
			heading: revealBeat(0, 0.56),
			subtitle: revealBeat(0.23, 0.46),
			button: revealBeat(0.28, 0.36),
			scrimIn: revealBeat(0, 0.32),
			scrimOut: revealBeat(1, 0.08)
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
		content: revealBeat(0.25, 0.1),
		descriptionHide: revealBeat(0.78, 0.26),
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
		content: revealBeat(0.3, 0.14),
		descriptionHide: revealBeat(0.8, 0.24),
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
			heading: revealBeat(0, 0.66),
			divider: revealBeat(0.14, 0.52),
			paragraph: revealBeat(0.15, 0.4),
			cardsReveal: revealBeat(0.18, 0.18),
			cardsMove: revealBeat(0.4, 0.54)
		},
		headingMotion: STANDARD_HEADING_MOTION.desktop,
		copyDuration: 1.02,
		cardItems: {
			surface: revealBeat(0, 0.64),
			number: revealBeat(0.1, 0.56),
			type: revealBeat(0.18, 0.48),
			description: revealBeat(0.28, 0.4),
			icon: revealBeat(0.4, 0.32)
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
			heading: revealBeat(0, 0.66),
			divider: revealBeat(0.14, 0.52),
			paragraph: revealBeat(0.44, 0.4),
			cardsReveal: revealBeat(0.15, 0.13),
			cardsMove: revealBeat(0.4, 0.54)
		},
		headingMotion: STANDARD_HEADING_MOTION.mobile,
		copyDuration: 0.84,
		cardItems: {
			surface: revealBeat(0, 0.68),
			number: revealBeat(0.08, 0.58),
			type: revealBeat(0.14, 0.5),
			description: revealBeat(0.24, 0.42),
			icon: revealBeat(0.34, 0.34)
		},
		cardsSmoothingMs: 135
	}
} as const;

export const TEAM_UI_TIMING = {
	desktop: {
		beats: {
			headingReveal: revealBeat(0, 0.21),
			headingHide: revealBeat(0.15, 0.18),
			cardsReveal: revealBeat(0.14, 0.16),
			cardsCycle: revealBeat(0.34, 0.58)
		},
		headingMotion: STANDARD_HEADING_MOTION.desktop,
		cardItems: {
			surface: revealBeat(0, 0.68),
			edge: revealBeat(0.14, 0.56),
			index: revealBeat(0.12, 0.62),
			title: revealBeat(0.18, 0.5),
			description: revealBeat(0.28, 0.44)
		},
		cardsSmoothingMs: 120
	},
	mobile: {
		beats: {
			headingReveal: revealBeat(0.04, 0.2),
			headingHide: revealBeat(0.4, 0.18),
			cardsReveal: revealBeat(0.18, 0.16),
			cardsCycle: revealBeat(0.4, 0.54)
		},
		headingMotion: STANDARD_HEADING_MOTION.mobile,
		cardItems: {
			surface: revealBeat(0, 0.66),
			edge: revealBeat(0.1, 0.58),
			index: revealBeat(0.1, 0.52),
			title: revealBeat(0.2, 0.44),
			description: revealBeat(0.32, 0.36)
		},
		cardsSmoothingMs: 135
	}
} as const;

export const CONTACT_UI_TIMING = {
	desktop: {
		panelRevealEnd: 0.3,
		revealWindow: 0.42,
		beats: {
			heading: revealBeat(0.02, 0.36),
			nameField: revealBeat(0.12, 0.34),
			emailField: revealBeat(0.18, 0.32),
			lead: revealBeat(0.28, 0.3),
			message: revealBeat(0.32, 0.28),
			submit: revealBeat(0.46, 0.26),
			lynksen: revealBeat(0.56, 0.24),
			socials: revealBeat(0.66, 0.22),
			footerPrimary: revealBeat(0.72, 0.2),
			footerSecondary: revealBeat(0.78, 0.18)
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
			heading: revealBeat(0.02, 0.22),
			lead: revealBeat(0.12, 0.21),
			lynksen: revealBeat(0.24, 0.2),
			socials: revealBeat(0.32, 0.19),
			nameField: revealBeat(0.42, 0.18),
			emailField: revealBeat(0.5, 0.17),
			message: revealBeat(0.58, 0.16),
			submit: revealBeat(0.68, 0.15),
			footerPrimary: revealBeat(0.78, 0.14),
			footerSecondary: revealBeat(0.84, 0.13)
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
