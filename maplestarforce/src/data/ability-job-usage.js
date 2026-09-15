// 이 파일은 scripts/refresh-ability-job-data.mjs가 생성합니다.
export const ABILITY_JOB_USAGE_SOURCE = Object.freeze({
  "source": "https://chuchu.gg/jobs",
  "retrievedAt": "2026-09-07T05:02:31.835Z",
  "jobCount": 48,
  "fallbackJobCount": 0
});

export const ABILITY_GLOBAL_POPULAR = Object.freeze({
  "all": {
    "main": [
      "item-drop",
      "boss-damage",
      "meso-drop",
      "cooldown-skip",
      "passive-level",
      "buff-duration",
      "multi-target",
      "normal-damage",
      "int",
      "str",
      "dex",
      "luk",
      "attack",
      "str-dex",
      "str-luk",
      "dex-int",
      "luk-int",
      "int-str",
      "max-hp",
      "max-mp",
      "int-dex",
      "luk-dex",
      "dex-luk",
      "str-int",
      "dex-str",
      "int-luk",
      "luk-str",
      "magic",
      "ap-luk-to-dex",
      "ap-int-to-luk",
      "ap-str-to-dex",
      "ap-dex-to-str",
      "all-stat",
      "abnormal-damage",
      "defense-damage",
      "critical",
      "attack-speed"
    ],
    "sub": [
      "abnormal-damage",
      "meso-drop",
      "normal-damage",
      "item-drop",
      "attack",
      "boss-damage",
      "buff-duration",
      "critical",
      "cooldown-skip",
      "magic",
      "all-stat",
      "str",
      "int",
      "max-hp",
      "dex",
      "luk",
      "str-dex",
      "str-int",
      "dex-int",
      "dex-luk",
      "dex-str",
      "int-str",
      "max-mp",
      "int-dex",
      "int-luk",
      "luk-dex",
      "str-luk",
      "luk-str",
      "luk-int",
      "ap-dex-to-str",
      "ap-luk-to-dex",
      "ap-int-to-luk",
      "ap-str-to-dex",
      "defense-damage"
    ]
  },
  "boss": {
    "main": [
      "boss-damage",
      "cooldown-skip",
      "passive-level",
      "buff-duration",
      "multi-target",
      "int",
      "str",
      "dex",
      "luk",
      "attack",
      "str-dex",
      "str-luk",
      "dex-int",
      "luk-int",
      "int-str",
      "max-hp",
      "max-mp",
      "int-dex",
      "luk-dex",
      "dex-luk",
      "str-int",
      "dex-str",
      "int-luk",
      "luk-str",
      "magic",
      "ap-luk-to-dex",
      "ap-int-to-luk",
      "ap-str-to-dex",
      "ap-dex-to-str",
      "all-stat",
      "abnormal-damage",
      "defense-damage",
      "critical",
      "attack-speed"
    ],
    "sub": [
      "abnormal-damage",
      "attack",
      "boss-damage",
      "buff-duration",
      "critical",
      "cooldown-skip",
      "magic",
      "all-stat",
      "str",
      "int",
      "max-hp",
      "dex",
      "luk",
      "str-dex",
      "str-int",
      "dex-int",
      "dex-luk",
      "dex-str",
      "int-str",
      "max-mp",
      "int-dex",
      "int-luk",
      "luk-dex",
      "str-luk",
      "luk-str",
      "luk-int",
      "ap-dex-to-str",
      "ap-luk-to-dex",
      "ap-int-to-luk",
      "ap-str-to-dex",
      "defense-damage"
    ]
  },
  "hunt": {
    "main": [
      "item-drop",
      "meso-drop",
      "normal-damage"
    ],
    "sub": [
      "meso-drop",
      "normal-damage",
      "item-drop"
    ]
  }
});

export const ABILITY_JOB_USAGE = Object.freeze([
  {
    "id": "나이트로드",
    "name": "나이트로드",
    "samples": 1000,
    "presets": {
      "boss": [
        "boss-damage",
        "abnormal-damage",
        "attack"
      ],
      "hunt": [
        "item-drop",
        "meso-drop",
        "normal-damage"
      ]
    },
    "rankings": {
      "boss": {
        "main": [
          {
            "type": "boss-damage",
            "count": 998,
            "rate": 99.8
          },
          {
            "type": "all-stat",
            "count": 4,
            "rate": 0.4
          },
          {
            "type": "luk-str",
            "count": 4,
            "rate": 0.4
          },
          {
            "type": "attack",
            "count": 3,
            "rate": 0.3
          },
          {
            "type": "cooldown-skip",
            "count": 3,
            "rate": 0.3
          },
          {
            "type": "dex",
            "count": 3,
            "rate": 0.3
          },
          {
            "type": "int",
            "count": 3,
            "rate": 0.3
          },
          {
            "type": "magic",
            "count": 3,
            "rate": 0.3
          }
        ],
        "sub": [
          {
            "type": "abnormal-damage",
            "count": 993,
            "rate": 99.3
          },
          {
            "type": "attack",
            "count": 862,
            "rate": 86.2
          },
          {
            "type": "buff-duration",
            "count": 611,
            "rate": 61.1
          },
          {
            "type": "cooldown-skip",
            "count": 13,
            "rate": 1.3
          },
          {
            "type": "luk",
            "count": 6,
            "rate": 0.6
          },
          {
            "type": "boss-damage",
            "count": 4,
            "rate": 0.4
          },
          {
            "type": "critical",
            "count": 4,
            "rate": 0.4
          },
          {
            "type": "ap-luk-to-dex",
            "count": 3,
            "rate": 0.3
          },
          {
            "type": "dex-int",
            "count": 3,
            "rate": 0.3
          },
          {
            "type": "int-dex",
            "count": 3,
            "rate": 0.3
          },
          {
            "type": "int-luk",
            "count": 3,
            "rate": 0.3
          },
          {
            "type": "all-stat",
            "count": 2,
            "rate": 0.2
          }
        ]
      },
      "hunt": {
        "main": [
          {
            "type": "item-drop",
            "count": 975,
            "rate": 97.5
          },
          {
            "type": "meso-drop",
            "count": 403,
            "rate": 40.3
          },
          {
            "type": "normal-damage",
            "count": 5,
            "rate": 0.5
          }
        ],
        "sub": [
          {
            "type": "meso-drop",
            "count": 878,
            "rate": 87.8
          },
          {
            "type": "normal-damage",
            "count": 770,
            "rate": 77
          },
          {
            "type": "item-drop",
            "count": 402,
            "rate": 40.2
          }
        ]
      }
    }
  },
  {
    "id": "나이트워커",
    "name": "나이트워커",
    "samples": 1000,
    "presets": {
      "boss": [
        "boss-damage",
        "abnormal-damage",
        "attack"
      ],
      "hunt": [
        "item-drop",
        "meso-drop",
        "normal-damage"
      ]
    },
    "rankings": {
      "boss": {
        "main": [
          {
            "type": "boss-damage",
            "count": 998,
            "rate": 99.8
          },
          {
            "type": "cooldown-skip",
            "count": 11,
            "rate": 1.1
          },
          {
            "type": "dex",
            "count": 8,
            "rate": 0.8
          },
          {
            "type": "int",
            "count": 7,
            "rate": 0.7
          },
          {
            "type": "int-luk",
            "count": 6,
            "rate": 0.6
          },
          {
            "type": "luk",
            "count": 5,
            "rate": 0.5
          },
          {
            "type": "magic",
            "count": 5,
            "rate": 0.5
          },
          {
            "type": "max-hp",
            "count": 5,
            "rate": 0.5
          }
        ],
        "sub": [
          {
            "type": "abnormal-damage",
            "count": 992,
            "rate": 99.2
          },
          {
            "type": "attack",
            "count": 882,
            "rate": 88.2
          },
          {
            "type": "buff-duration",
            "count": 167,
            "rate": 16.7
          },
          {
            "type": "cooldown-skip",
            "count": 138,
            "rate": 13.8
          },
          {
            "type": "critical",
            "count": 107,
            "rate": 10.7
          },
          {
            "type": "boss-damage",
            "count": 12,
            "rate": 1.2
          },
          {
            "type": "all-stat",
            "count": 11,
            "rate": 1.1
          },
          {
            "type": "luk",
            "count": 11,
            "rate": 1.1
          },
          {
            "type": "dex-int",
            "count": 8,
            "rate": 0.8
          },
          {
            "type": "max-mp",
            "count": 7,
            "rate": 0.7
          },
          {
            "type": "dex",
            "count": 6,
            "rate": 0.6
          },
          {
            "type": "dex-str",
            "count": 5,
            "rate": 0.5
          }
        ]
      },
      "hunt": {
        "main": [
          {
            "type": "item-drop",
            "count": 947,
            "rate": 94.7
          },
          {
            "type": "meso-drop",
            "count": 505,
            "rate": 50.5
          },
          {
            "type": "normal-damage",
            "count": 7,
            "rate": 0.7
          }
        ],
        "sub": [
          {
            "type": "meso-drop",
            "count": 758,
            "rate": 75.8
          },
          {
            "type": "normal-damage",
            "count": 641,
            "rate": 64.1
          },
          {
            "type": "item-drop",
            "count": 493,
            "rate": 49.3
          }
        ]
      }
    }
  },
  {
    "id": "다크나이트",
    "name": "다크나이트",
    "samples": 1000,
    "presets": {
      "boss": [
        "boss-damage",
        "abnormal-damage",
        "cooldown-skip"
      ],
      "hunt": [
        "item-drop",
        "meso-drop",
        "normal-damage"
      ]
    },
    "rankings": {
      "boss": {
        "main": [
          {
            "type": "boss-damage",
            "count": 992,
            "rate": 99.2
          },
          {
            "type": "cooldown-skip",
            "count": 111,
            "rate": 11.1
          },
          {
            "type": "buff-duration",
            "count": 39,
            "rate": 3.9
          },
          {
            "type": "str-dex",
            "count": 9,
            "rate": 0.9
          },
          {
            "type": "dex",
            "count": 8,
            "rate": 0.8
          },
          {
            "type": "str",
            "count": 5,
            "rate": 0.5
          },
          {
            "type": "int-dex",
            "count": 4,
            "rate": 0.4
          },
          {
            "type": "luk-dex",
            "count": 4,
            "rate": 0.4
          }
        ],
        "sub": [
          {
            "type": "abnormal-damage",
            "count": 973,
            "rate": 97.3
          },
          {
            "type": "cooldown-skip",
            "count": 824,
            "rate": 82.4
          },
          {
            "type": "buff-duration",
            "count": 528,
            "rate": 52.8
          },
          {
            "type": "boss-damage",
            "count": 116,
            "rate": 11.6
          },
          {
            "type": "attack",
            "count": 91,
            "rate": 9.1
          },
          {
            "type": "str",
            "count": 15,
            "rate": 1.5
          },
          {
            "type": "all-stat",
            "count": 7,
            "rate": 0.7
          },
          {
            "type": "dex-int",
            "count": 7,
            "rate": 0.7
          },
          {
            "type": "critical",
            "count": 6,
            "rate": 0.6
          },
          {
            "type": "max-hp",
            "count": 6,
            "rate": 0.6
          },
          {
            "type": "str-luk",
            "count": 6,
            "rate": 0.6
          },
          {
            "type": "int",
            "count": 5,
            "rate": 0.5
          }
        ]
      },
      "hunt": {
        "main": [
          {
            "type": "item-drop",
            "count": 924,
            "rate": 92.4
          },
          {
            "type": "meso-drop",
            "count": 316,
            "rate": 31.6
          },
          {
            "type": "normal-damage",
            "count": 6,
            "rate": 0.6
          }
        ],
        "sub": [
          {
            "type": "meso-drop",
            "count": 828,
            "rate": 82.8
          },
          {
            "type": "normal-damage",
            "count": 592,
            "rate": 59.2
          },
          {
            "type": "item-drop",
            "count": 315,
            "rate": 31.5
          }
        ]
      }
    }
  },
  {
    "id": "데몬슬레이어",
    "name": "데몬슬레이어",
    "samples": 1000,
    "presets": {
      "boss": [
        "boss-damage",
        "abnormal-damage",
        "buff-duration"
      ],
      "hunt": [
        "item-drop",
        "meso-drop",
        "normal-damage"
      ]
    },
    "rankings": {
      "boss": {
        "main": [
          {
            "type": "boss-damage",
            "count": 948,
            "rate": 94.8
          },
          {
            "type": "cooldown-skip",
            "count": 403,
            "rate": 40.3
          },
          {
            "type": "attack",
            "count": 7,
            "rate": 0.7
          },
          {
            "type": "str",
            "count": 7,
            "rate": 0.7
          },
          {
            "type": "buff-duration",
            "count": 6,
            "rate": 0.6
          },
          {
            "type": "dex",
            "count": 6,
            "rate": 0.6
          },
          {
            "type": "dex-int",
            "count": 6,
            "rate": 0.6
          },
          {
            "type": "int-luk",
            "count": 5,
            "rate": 0.5
          }
        ],
        "sub": [
          {
            "type": "abnormal-damage",
            "count": 940,
            "rate": 94
          },
          {
            "type": "buff-duration",
            "count": 757,
            "rate": 75.7
          },
          {
            "type": "boss-damage",
            "count": 299,
            "rate": 29.9
          },
          {
            "type": "cooldown-skip",
            "count": 244,
            "rate": 24.4
          },
          {
            "type": "attack",
            "count": 233,
            "rate": 23.3
          },
          {
            "type": "critical",
            "count": 25,
            "rate": 2.5
          },
          {
            "type": "all-stat",
            "count": 17,
            "rate": 1.7
          },
          {
            "type": "str",
            "count": 9,
            "rate": 0.9
          },
          {
            "type": "dex",
            "count": 5,
            "rate": 0.5
          },
          {
            "type": "int",
            "count": 5,
            "rate": 0.5
          },
          {
            "type": "int-luk",
            "count": 5,
            "rate": 0.5
          },
          {
            "type": "int-str",
            "count": 5,
            "rate": 0.5
          }
        ]
      },
      "hunt": {
        "main": [
          {
            "type": "item-drop",
            "count": 892,
            "rate": 89.2
          },
          {
            "type": "meso-drop",
            "count": 288,
            "rate": 28.8
          },
          {
            "type": "normal-damage",
            "count": 7,
            "rate": 0.7
          }
        ],
        "sub": [
          {
            "type": "meso-drop",
            "count": 773,
            "rate": 77.3
          },
          {
            "type": "normal-damage",
            "count": 489,
            "rate": 48.9
          },
          {
            "type": "item-drop",
            "count": 280,
            "rate": 28
          }
        ]
      }
    }
  },
  {
    "id": "데몬어벤져",
    "name": "데몬어벤져",
    "samples": 1000,
    "presets": {
      "boss": [
        "cooldown-skip",
        "abnormal-damage",
        "boss-damage"
      ],
      "hunt": [
        "item-drop",
        "meso-drop",
        "normal-damage"
      ]
    },
    "rankings": {
      "boss": {
        "main": [
          {
            "type": "cooldown-skip",
            "count": 991,
            "rate": 99.1
          },
          {
            "type": "boss-damage",
            "count": 62,
            "rate": 6.2
          },
          {
            "type": "max-hp",
            "count": 12,
            "rate": 1.2
          },
          {
            "type": "dex",
            "count": 8,
            "rate": 0.8
          },
          {
            "type": "dex-int",
            "count": 8,
            "rate": 0.8
          },
          {
            "type": "all-stat",
            "count": 6,
            "rate": 0.6
          },
          {
            "type": "str-dex",
            "count": 6,
            "rate": 0.6
          },
          {
            "type": "attack",
            "count": 5,
            "rate": 0.5
          }
        ],
        "sub": [
          {
            "type": "abnormal-damage",
            "count": 952,
            "rate": 95.2
          },
          {
            "type": "boss-damage",
            "count": 947,
            "rate": 94.7
          },
          {
            "type": "cooldown-skip",
            "count": 147,
            "rate": 14.7
          },
          {
            "type": "critical",
            "count": 129,
            "rate": 12.9
          },
          {
            "type": "max-hp",
            "count": 107,
            "rate": 10.7
          },
          {
            "type": "attack",
            "count": 97,
            "rate": 9.7
          },
          {
            "type": "buff-duration",
            "count": 36,
            "rate": 3.6
          },
          {
            "type": "str-dex",
            "count": 10,
            "rate": 1
          },
          {
            "type": "str-luk",
            "count": 7,
            "rate": 0.7
          },
          {
            "type": "dex-luk",
            "count": 6,
            "rate": 0.6
          },
          {
            "type": "luk-str",
            "count": 5,
            "rate": 0.5
          },
          {
            "type": "str",
            "count": 5,
            "rate": 0.5
          }
        ]
      },
      "hunt": {
        "main": [
          {
            "type": "item-drop",
            "count": 924,
            "rate": 92.4
          },
          {
            "type": "meso-drop",
            "count": 493,
            "rate": 49.3
          },
          {
            "type": "normal-damage",
            "count": 10,
            "rate": 1
          }
        ],
        "sub": [
          {
            "type": "meso-drop",
            "count": 801,
            "rate": 80.1
          },
          {
            "type": "normal-damage",
            "count": 556,
            "rate": 55.6
          },
          {
            "type": "item-drop",
            "count": 536,
            "rate": 53.6
          }
        ]
      }
    }
  },
  {
    "id": "듀얼블레이더",
    "name": "듀얼블레이더",
    "samples": 1000,
    "presets": {
      "boss": [
        "boss-damage",
        "abnormal-damage",
        "attack"
      ],
      "hunt": [
        "item-drop",
        "meso-drop",
        "normal-damage"
      ]
    },
    "rankings": {
      "boss": {
        "main": [
          {
            "type": "boss-damage",
            "count": 999,
            "rate": 99.9
          },
          {
            "type": "cooldown-skip",
            "count": 11,
            "rate": 1.1
          },
          {
            "type": "luk-int",
            "count": 6,
            "rate": 0.6
          },
          {
            "type": "ap-luk-to-dex",
            "count": 5,
            "rate": 0.5
          },
          {
            "type": "dex",
            "count": 5,
            "rate": 0.5
          },
          {
            "type": "int",
            "count": 5,
            "rate": 0.5
          },
          {
            "type": "int-luk",
            "count": 4,
            "rate": 0.4
          },
          {
            "type": "dex-luk",
            "count": 3,
            "rate": 0.3
          }
        ],
        "sub": [
          {
            "type": "abnormal-damage",
            "count": 991,
            "rate": 99.1
          },
          {
            "type": "attack",
            "count": 731,
            "rate": 73.1
          },
          {
            "type": "buff-duration",
            "count": 611,
            "rate": 61.1
          },
          {
            "type": "cooldown-skip",
            "count": 86,
            "rate": 8.6
          },
          {
            "type": "critical",
            "count": 80,
            "rate": 8
          },
          {
            "type": "boss-damage",
            "count": 17,
            "rate": 1.7
          },
          {
            "type": "all-stat",
            "count": 10,
            "rate": 1
          },
          {
            "type": "dex-luk",
            "count": 6,
            "rate": 0.6
          },
          {
            "type": "luk",
            "count": 5,
            "rate": 0.5
          },
          {
            "type": "luk-dex",
            "count": 5,
            "rate": 0.5
          },
          {
            "type": "luk-str",
            "count": 5,
            "rate": 0.5
          },
          {
            "type": "int",
            "count": 4,
            "rate": 0.4
          }
        ]
      },
      "hunt": {
        "main": [
          {
            "type": "item-drop",
            "count": 969,
            "rate": 96.9
          },
          {
            "type": "meso-drop",
            "count": 432,
            "rate": 43.2
          },
          {
            "type": "normal-damage",
            "count": 4,
            "rate": 0.4
          }
        ],
        "sub": [
          {
            "type": "meso-drop",
            "count": 846,
            "rate": 84.6
          },
          {
            "type": "normal-damage",
            "count": 622,
            "rate": 62.2
          },
          {
            "type": "item-drop",
            "count": 423,
            "rate": 42.3
          }
        ]
      }
    }
  },
  {
    "id": "라라",
    "name": "라라",
    "samples": 1000,
    "presets": {
      "boss": [
        "passive-level",
        "abnormal-damage",
        "boss-damage"
      ],
      "hunt": [
        "item-drop",
        "meso-drop",
        "normal-damage"
      ]
    },
    "rankings": {
      "boss": {
        "main": [
          {
            "type": "passive-level",
            "count": 985,
            "rate": 98.5
          },
          {
            "type": "boss-damage",
            "count": 61,
            "rate": 6.1
          },
          {
            "type": "cooldown-skip",
            "count": 44,
            "rate": 4.4
          },
          {
            "type": "dex-int",
            "count": 6,
            "rate": 0.6
          },
          {
            "type": "defense-damage",
            "count": 5,
            "rate": 0.5
          },
          {
            "type": "int-luk",
            "count": 5,
            "rate": 0.5
          },
          {
            "type": "int-str",
            "count": 5,
            "rate": 0.5
          },
          {
            "type": "luk",
            "count": 5,
            "rate": 0.5
          }
        ],
        "sub": [
          {
            "type": "abnormal-damage",
            "count": 970,
            "rate": 97
          },
          {
            "type": "boss-damage",
            "count": 956,
            "rate": 95.6
          },
          {
            "type": "magic",
            "count": 115,
            "rate": 11.5
          },
          {
            "type": "buff-duration",
            "count": 32,
            "rate": 3.2
          },
          {
            "type": "critical",
            "count": 31,
            "rate": 3.1
          },
          {
            "type": "cooldown-skip",
            "count": 28,
            "rate": 2.8
          },
          {
            "type": "int",
            "count": 17,
            "rate": 1.7
          },
          {
            "type": "all-stat",
            "count": 12,
            "rate": 1.2
          },
          {
            "type": "int-luk",
            "count": 10,
            "rate": 1
          },
          {
            "type": "int-str",
            "count": 10,
            "rate": 1
          },
          {
            "type": "ap-dex-to-str",
            "count": 7,
            "rate": 0.7
          },
          {
            "type": "luk-dex",
            "count": 6,
            "rate": 0.6
          }
        ]
      },
      "hunt": {
        "main": [
          {
            "type": "item-drop",
            "count": 931,
            "rate": 93.1
          },
          {
            "type": "meso-drop",
            "count": 620,
            "rate": 62
          },
          {
            "type": "normal-damage",
            "count": 6,
            "rate": 0.6
          }
        ],
        "sub": [
          {
            "type": "meso-drop",
            "count": 771,
            "rate": 77.1
          },
          {
            "type": "normal-damage",
            "count": 655,
            "rate": 65.5
          },
          {
            "type": "item-drop",
            "count": 612,
            "rate": 61.2
          }
        ]
      }
    }
  },
  {
    "id": "레테",
    "name": "레테",
    "samples": 1000,
    "presets": {
      "boss": [
        "cooldown-skip",
        "abnormal-damage",
        "boss-damage"
      ],
      "hunt": [
        "item-drop",
        "meso-drop",
        "normal-damage"
      ]
    },
    "rankings": {
      "boss": {
        "main": [
          {
            "type": "cooldown-skip",
            "count": 995,
            "rate": 99.5
          },
          {
            "type": "dex",
            "count": 15,
            "rate": 1.5
          },
          {
            "type": "int",
            "count": 14,
            "rate": 1.4
          },
          {
            "type": "luk-dex",
            "count": 12,
            "rate": 1.2
          },
          {
            "type": "str-luk",
            "count": 12,
            "rate": 1.2
          },
          {
            "type": "dex-luk",
            "count": 11,
            "rate": 1.1
          },
          {
            "type": "int-dex",
            "count": 11,
            "rate": 1.1
          },
          {
            "type": "int-luk",
            "count": 11,
            "rate": 1.1
          }
        ],
        "sub": [
          {
            "type": "abnormal-damage",
            "count": 932,
            "rate": 93.2
          },
          {
            "type": "boss-damage",
            "count": 855,
            "rate": 85.5
          },
          {
            "type": "magic",
            "count": 100,
            "rate": 10
          },
          {
            "type": "int",
            "count": 26,
            "rate": 2.6
          },
          {
            "type": "dex",
            "count": 17,
            "rate": 1.7
          },
          {
            "type": "all-stat",
            "count": 16,
            "rate": 1.6
          },
          {
            "type": "int-str",
            "count": 16,
            "rate": 1.6
          },
          {
            "type": "luk-str",
            "count": 16,
            "rate": 1.6
          },
          {
            "type": "cooldown-skip",
            "count": 15,
            "rate": 1.5
          },
          {
            "type": "dex-luk",
            "count": 15,
            "rate": 1.5
          },
          {
            "type": "int-dex",
            "count": 15,
            "rate": 1.5
          },
          {
            "type": "str-int",
            "count": 15,
            "rate": 1.5
          }
        ]
      },
      "hunt": {
        "main": [
          {
            "type": "item-drop",
            "count": 857,
            "rate": 85.7
          },
          {
            "type": "meso-drop",
            "count": 530,
            "rate": 53
          },
          {
            "type": "normal-damage",
            "count": 13,
            "rate": 1.3
          }
        ],
        "sub": [
          {
            "type": "meso-drop",
            "count": 557,
            "rate": 55.7
          },
          {
            "type": "item-drop",
            "count": 470,
            "rate": 47
          },
          {
            "type": "normal-damage",
            "count": 226,
            "rate": 22.6
          }
        ]
      }
    }
  },
  {
    "id": "렌",
    "name": "렌",
    "samples": 1000,
    "presets": {
      "boss": [
        "boss-damage",
        "abnormal-damage",
        "attack"
      ],
      "hunt": [
        "item-drop",
        "meso-drop",
        "normal-damage"
      ]
    },
    "rankings": {
      "boss": {
        "main": [
          {
            "type": "boss-damage",
            "count": 999,
            "rate": 99.9
          },
          {
            "type": "luk-int",
            "count": 7,
            "rate": 0.7
          },
          {
            "type": "str",
            "count": 6,
            "rate": 0.6
          },
          {
            "type": "dex-int",
            "count": 4,
            "rate": 0.4
          },
          {
            "type": "luk-str",
            "count": 4,
            "rate": 0.4
          },
          {
            "type": "str-dex",
            "count": 4,
            "rate": 0.4
          },
          {
            "type": "ap-luk-to-dex",
            "count": 3,
            "rate": 0.3
          },
          {
            "type": "attack",
            "count": 3,
            "rate": 0.3
          }
        ],
        "sub": [
          {
            "type": "abnormal-damage",
            "count": 995,
            "rate": 99.5
          },
          {
            "type": "attack",
            "count": 966,
            "rate": 96.6
          },
          {
            "type": "buff-duration",
            "count": 122,
            "rate": 12.2
          },
          {
            "type": "boss-damage",
            "count": 14,
            "rate": 1.4
          },
          {
            "type": "luk-dex",
            "count": 11,
            "rate": 1.1
          },
          {
            "type": "str",
            "count": 11,
            "rate": 1.1
          },
          {
            "type": "all-stat",
            "count": 9,
            "rate": 0.9
          },
          {
            "type": "critical",
            "count": 8,
            "rate": 0.8
          },
          {
            "type": "int-str",
            "count": 8,
            "rate": 0.8
          },
          {
            "type": "str-int",
            "count": 8,
            "rate": 0.8
          },
          {
            "type": "luk",
            "count": 7,
            "rate": 0.7
          },
          {
            "type": "cooldown-skip",
            "count": 6,
            "rate": 0.6
          }
        ]
      },
      "hunt": {
        "main": [
          {
            "type": "item-drop",
            "count": 973,
            "rate": 97.3
          },
          {
            "type": "meso-drop",
            "count": 697,
            "rate": 69.7
          },
          {
            "type": "normal-damage",
            "count": 4,
            "rate": 0.4
          }
        ],
        "sub": [
          {
            "type": "meso-drop",
            "count": 736,
            "rate": 73.6
          },
          {
            "type": "normal-damage",
            "count": 700,
            "rate": 70
          },
          {
            "type": "item-drop",
            "count": 682,
            "rate": 68.2
          }
        ]
      }
    }
  },
  {
    "id": "루미너스",
    "name": "루미너스",
    "samples": 1000,
    "presets": {
      "boss": [
        "cooldown-skip",
        "boss-damage",
        "abnormal-damage"
      ],
      "hunt": [
        "item-drop",
        "meso-drop",
        "normal-damage"
      ]
    },
    "rankings": {
      "boss": {
        "main": [
          {
            "type": "cooldown-skip",
            "count": 965,
            "rate": 96.5
          },
          {
            "type": "buff-duration",
            "count": 179,
            "rate": 17.9
          },
          {
            "type": "boss-damage",
            "count": 69,
            "rate": 6.9
          },
          {
            "type": "multi-target",
            "count": 67,
            "rate": 6.7
          },
          {
            "type": "int-str",
            "count": 8,
            "rate": 0.8
          },
          {
            "type": "ap-str-to-dex",
            "count": 7,
            "rate": 0.7
          },
          {
            "type": "attack",
            "count": 6,
            "rate": 0.6
          },
          {
            "type": "dex",
            "count": 6,
            "rate": 0.6
          }
        ],
        "sub": [
          {
            "type": "boss-damage",
            "count": 926,
            "rate": 92.6
          },
          {
            "type": "abnormal-damage",
            "count": 902,
            "rate": 90.2
          },
          {
            "type": "buff-duration",
            "count": 323,
            "rate": 32.3
          },
          {
            "type": "critical",
            "count": 93,
            "rate": 9.3
          },
          {
            "type": "magic",
            "count": 88,
            "rate": 8.8
          },
          {
            "type": "cooldown-skip",
            "count": 51,
            "rate": 5.1
          },
          {
            "type": "all-stat",
            "count": 11,
            "rate": 1.1
          },
          {
            "type": "ap-int-to-luk",
            "count": 10,
            "rate": 1
          },
          {
            "type": "int",
            "count": 9,
            "rate": 0.9
          },
          {
            "type": "int-luk",
            "count": 9,
            "rate": 0.9
          },
          {
            "type": "luk-str",
            "count": 9,
            "rate": 0.9
          },
          {
            "type": "int-str",
            "count": 8,
            "rate": 0.8
          }
        ]
      },
      "hunt": {
        "main": [
          {
            "type": "item-drop",
            "count": 826,
            "rate": 82.6
          },
          {
            "type": "meso-drop",
            "count": 388,
            "rate": 38.8
          },
          {
            "type": "normal-damage",
            "count": 8,
            "rate": 0.8
          }
        ],
        "sub": [
          {
            "type": "meso-drop",
            "count": 715,
            "rate": 71.5
          },
          {
            "type": "normal-damage",
            "count": 462,
            "rate": 46.2
          },
          {
            "type": "item-drop",
            "count": 437,
            "rate": 43.7
          }
        ]
      }
    }
  },
  {
    "id": "메르세데스",
    "name": "메르세데스",
    "samples": 1000,
    "presets": {
      "boss": [
        "boss-damage",
        "abnormal-damage",
        "critical"
      ],
      "hunt": [
        "item-drop",
        "meso-drop",
        "normal-damage"
      ]
    },
    "rankings": {
      "boss": {
        "main": [
          {
            "type": "boss-damage",
            "count": 999,
            "rate": 99.9
          },
          {
            "type": "cooldown-skip",
            "count": 34,
            "rate": 3.4
          },
          {
            "type": "int",
            "count": 7,
            "rate": 0.7
          },
          {
            "type": "critical",
            "count": 6,
            "rate": 0.6
          },
          {
            "type": "dex-int",
            "count": 6,
            "rate": 0.6
          },
          {
            "type": "dex-str",
            "count": 6,
            "rate": 0.6
          },
          {
            "type": "luk",
            "count": 6,
            "rate": 0.6
          },
          {
            "type": "str-dex",
            "count": 6,
            "rate": 0.6
          }
        ],
        "sub": [
          {
            "type": "abnormal-damage",
            "count": 978,
            "rate": 97.8
          },
          {
            "type": "critical",
            "count": 974,
            "rate": 97.4
          },
          {
            "type": "attack",
            "count": 106,
            "rate": 10.6
          },
          {
            "type": "cooldown-skip",
            "count": 29,
            "rate": 2.9
          },
          {
            "type": "buff-duration",
            "count": 28,
            "rate": 2.8
          },
          {
            "type": "boss-damage",
            "count": 25,
            "rate": 2.5
          },
          {
            "type": "all-stat",
            "count": 12,
            "rate": 1.2
          },
          {
            "type": "dex-luk",
            "count": 8,
            "rate": 0.8
          },
          {
            "type": "dex-str",
            "count": 8,
            "rate": 0.8
          },
          {
            "type": "dex",
            "count": 7,
            "rate": 0.7
          },
          {
            "type": "str-int",
            "count": 7,
            "rate": 0.7
          },
          {
            "type": "int-str",
            "count": 6,
            "rate": 0.6
          }
        ]
      },
      "hunt": {
        "main": [
          {
            "type": "item-drop",
            "count": 957,
            "rate": 95.7
          },
          {
            "type": "meso-drop",
            "count": 575,
            "rate": 57.5
          },
          {
            "type": "normal-damage",
            "count": 11,
            "rate": 1.1
          }
        ],
        "sub": [
          {
            "type": "meso-drop",
            "count": 797,
            "rate": 79.7
          },
          {
            "type": "normal-damage",
            "count": 674,
            "rate": 67.4
          },
          {
            "type": "item-drop",
            "count": 565,
            "rate": 56.5
          }
        ]
      }
    }
  },
  {
    "id": "메카닉",
    "name": "메카닉",
    "samples": 1000,
    "presets": {
      "boss": [
        "boss-damage",
        "abnormal-damage",
        "buff-duration"
      ],
      "hunt": [
        "item-drop",
        "meso-drop",
        "normal-damage"
      ]
    },
    "rankings": {
      "boss": {
        "main": [
          {
            "type": "boss-damage",
            "count": 986,
            "rate": 98.6
          },
          {
            "type": "passive-level",
            "count": 92,
            "rate": 9.2
          },
          {
            "type": "cooldown-skip",
            "count": 26,
            "rate": 2.6
          },
          {
            "type": "attack",
            "count": 9,
            "rate": 0.9
          },
          {
            "type": "max-mp",
            "count": 9,
            "rate": 0.9
          },
          {
            "type": "buff-duration",
            "count": 6,
            "rate": 0.6
          },
          {
            "type": "dex-str",
            "count": 6,
            "rate": 0.6
          },
          {
            "type": "dex-luk",
            "count": 5,
            "rate": 0.5
          }
        ],
        "sub": [
          {
            "type": "abnormal-damage",
            "count": 957,
            "rate": 95.7
          },
          {
            "type": "buff-duration",
            "count": 684,
            "rate": 68.4
          },
          {
            "type": "attack",
            "count": 411,
            "rate": 41.1
          },
          {
            "type": "boss-damage",
            "count": 77,
            "rate": 7.7
          },
          {
            "type": "cooldown-skip",
            "count": 21,
            "rate": 2.1
          },
          {
            "type": "dex",
            "count": 15,
            "rate": 1.5
          },
          {
            "type": "critical",
            "count": 14,
            "rate": 1.4
          },
          {
            "type": "all-stat",
            "count": 12,
            "rate": 1.2
          },
          {
            "type": "dex-str",
            "count": 10,
            "rate": 1
          },
          {
            "type": "dex-luk",
            "count": 9,
            "rate": 0.9
          },
          {
            "type": "luk-int",
            "count": 8,
            "rate": 0.8
          },
          {
            "type": "max-hp",
            "count": 8,
            "rate": 0.8
          }
        ]
      },
      "hunt": {
        "main": [
          {
            "type": "item-drop",
            "count": 858,
            "rate": 85.8
          },
          {
            "type": "meso-drop",
            "count": 430,
            "rate": 43
          },
          {
            "type": "normal-damage",
            "count": 16,
            "rate": 1.6
          }
        ],
        "sub": [
          {
            "type": "meso-drop",
            "count": 676,
            "rate": 67.6
          },
          {
            "type": "normal-damage",
            "count": 496,
            "rate": 49.6
          },
          {
            "type": "item-drop",
            "count": 428,
            "rate": 42.8
          }
        ]
      }
    }
  },
  {
    "id": "미하일",
    "name": "미하일",
    "samples": 1000,
    "presets": {
      "boss": [
        "boss-damage",
        "abnormal-damage",
        "cooldown-skip"
      ],
      "hunt": [
        "item-drop",
        "meso-drop",
        "normal-damage"
      ]
    },
    "rankings": {
      "boss": {
        "main": [
          {
            "type": "boss-damage",
            "count": 870,
            "rate": 87
          },
          {
            "type": "cooldown-skip",
            "count": 401,
            "rate": 40.1
          },
          {
            "type": "buff-duration",
            "count": 22,
            "rate": 2.2
          },
          {
            "type": "max-hp",
            "count": 9,
            "rate": 0.9
          },
          {
            "type": "luk",
            "count": 8,
            "rate": 0.8
          },
          {
            "type": "luk-dex",
            "count": 8,
            "rate": 0.8
          },
          {
            "type": "dex",
            "count": 7,
            "rate": 0.7
          },
          {
            "type": "dex-luk",
            "count": 7,
            "rate": 0.7
          }
        ],
        "sub": [
          {
            "type": "abnormal-damage",
            "count": 942,
            "rate": 94.2
          },
          {
            "type": "cooldown-skip",
            "count": 522,
            "rate": 52.2
          },
          {
            "type": "buff-duration",
            "count": 359,
            "rate": 35.9
          },
          {
            "type": "boss-damage",
            "count": 346,
            "rate": 34.6
          },
          {
            "type": "attack",
            "count": 162,
            "rate": 16.2
          },
          {
            "type": "critical",
            "count": 42,
            "rate": 4.2
          },
          {
            "type": "str",
            "count": 15,
            "rate": 1.5
          },
          {
            "type": "str-dex",
            "count": 12,
            "rate": 1.2
          },
          {
            "type": "dex-int",
            "count": 11,
            "rate": 1.1
          },
          {
            "type": "all-stat",
            "count": 10,
            "rate": 1
          },
          {
            "type": "dex-luk",
            "count": 7,
            "rate": 0.7
          },
          {
            "type": "str-luk",
            "count": 7,
            "rate": 0.7
          }
        ]
      },
      "hunt": {
        "main": [
          {
            "type": "item-drop",
            "count": 869,
            "rate": 86.9
          },
          {
            "type": "meso-drop",
            "count": 304,
            "rate": 30.4
          },
          {
            "type": "normal-damage",
            "count": 10,
            "rate": 1
          }
        ],
        "sub": [
          {
            "type": "meso-drop",
            "count": 699,
            "rate": 69.9
          },
          {
            "type": "normal-damage",
            "count": 462,
            "rate": 46.2
          },
          {
            "type": "item-drop",
            "count": 306,
            "rate": 30.6
          }
        ]
      }
    }
  },
  {
    "id": "바이퍼",
    "name": "바이퍼",
    "samples": 1000,
    "presets": {
      "boss": [
        "boss-damage",
        "abnormal-damage",
        "attack"
      ],
      "hunt": [
        "item-drop",
        "meso-drop",
        "normal-damage"
      ]
    },
    "rankings": {
      "boss": {
        "main": [
          {
            "type": "boss-damage",
            "count": 888,
            "rate": 88.8
          },
          {
            "type": "passive-level",
            "count": 397,
            "rate": 39.7
          },
          {
            "type": "cooldown-skip",
            "count": 15,
            "rate": 1.5
          },
          {
            "type": "int-str",
            "count": 8,
            "rate": 0.8
          },
          {
            "type": "attack",
            "count": 7,
            "rate": 0.7
          },
          {
            "type": "str",
            "count": 7,
            "rate": 0.7
          },
          {
            "type": "str-dex",
            "count": 7,
            "rate": 0.7
          },
          {
            "type": "dex",
            "count": 6,
            "rate": 0.6
          }
        ],
        "sub": [
          {
            "type": "abnormal-damage",
            "count": 987,
            "rate": 98.7
          },
          {
            "type": "attack",
            "count": 875,
            "rate": 87.5
          },
          {
            "type": "boss-damage",
            "count": 398,
            "rate": 39.8
          },
          {
            "type": "buff-duration",
            "count": 36,
            "rate": 3.6
          },
          {
            "type": "critical",
            "count": 35,
            "rate": 3.5
          },
          {
            "type": "str",
            "count": 9,
            "rate": 0.9
          },
          {
            "type": "all-stat",
            "count": 8,
            "rate": 0.8
          },
          {
            "type": "cooldown-skip",
            "count": 8,
            "rate": 0.8
          },
          {
            "type": "luk",
            "count": 5,
            "rate": 0.5
          },
          {
            "type": "str-dex",
            "count": 5,
            "rate": 0.5
          },
          {
            "type": "dex-luk",
            "count": 4,
            "rate": 0.4
          },
          {
            "type": "int-dex",
            "count": 4,
            "rate": 0.4
          }
        ]
      },
      "hunt": {
        "main": [
          {
            "type": "item-drop",
            "count": 941,
            "rate": 94.1
          },
          {
            "type": "meso-drop",
            "count": 481,
            "rate": 48.1
          },
          {
            "type": "normal-damage",
            "count": 11,
            "rate": 1.1
          }
        ],
        "sub": [
          {
            "type": "meso-drop",
            "count": 791,
            "rate": 79.1
          },
          {
            "type": "normal-damage",
            "count": 706,
            "rate": 70.6
          },
          {
            "type": "item-drop",
            "count": 482,
            "rate": 48.2
          }
        ]
      }
    }
  },
  {
    "id": "배틀메이지",
    "name": "배틀메이지",
    "samples": 1000,
    "presets": {
      "boss": [
        "boss-damage",
        "abnormal-damage",
        "magic"
      ],
      "hunt": [
        "item-drop",
        "meso-drop",
        "normal-damage"
      ]
    },
    "rankings": {
      "boss": {
        "main": [
          {
            "type": "boss-damage",
            "count": 999,
            "rate": 99.9
          },
          {
            "type": "cooldown-skip",
            "count": 9,
            "rate": 0.9
          },
          {
            "type": "str-dex",
            "count": 9,
            "rate": 0.9
          },
          {
            "type": "max-mp",
            "count": 8,
            "rate": 0.8
          },
          {
            "type": "int",
            "count": 7,
            "rate": 0.7
          },
          {
            "type": "str",
            "count": 7,
            "rate": 0.7
          },
          {
            "type": "str-int",
            "count": 7,
            "rate": 0.7
          },
          {
            "type": "ap-str-to-dex",
            "count": 6,
            "rate": 0.6
          }
        ],
        "sub": [
          {
            "type": "abnormal-damage",
            "count": 986,
            "rate": 98.6
          },
          {
            "type": "magic",
            "count": 950,
            "rate": 95
          },
          {
            "type": "buff-duration",
            "count": 91,
            "rate": 9.1
          },
          {
            "type": "critical",
            "count": 40,
            "rate": 4
          },
          {
            "type": "cooldown-skip",
            "count": 29,
            "rate": 2.9
          },
          {
            "type": "int",
            "count": 17,
            "rate": 1.7
          },
          {
            "type": "all-stat",
            "count": 16,
            "rate": 1.6
          },
          {
            "type": "boss-damage",
            "count": 11,
            "rate": 1.1
          },
          {
            "type": "int-luk",
            "count": 10,
            "rate": 1
          },
          {
            "type": "max-hp",
            "count": 9,
            "rate": 0.9
          },
          {
            "type": "luk",
            "count": 8,
            "rate": 0.8
          },
          {
            "type": "luk-str",
            "count": 8,
            "rate": 0.8
          }
        ]
      },
      "hunt": {
        "main": [
          {
            "type": "item-drop",
            "count": 936,
            "rate": 93.6
          },
          {
            "type": "meso-drop",
            "count": 529,
            "rate": 52.9
          },
          {
            "type": "normal-damage",
            "count": 11,
            "rate": 1.1
          }
        ],
        "sub": [
          {
            "type": "meso-drop",
            "count": 735,
            "rate": 73.5
          },
          {
            "type": "normal-damage",
            "count": 605,
            "rate": 60.5
          },
          {
            "type": "item-drop",
            "count": 517,
            "rate": 51.7
          }
        ]
      }
    }
  },
  {
    "id": "보우마스터",
    "name": "보우마스터",
    "samples": 1000,
    "presets": {
      "boss": [
        "boss-damage",
        "abnormal-damage",
        "critical"
      ],
      "hunt": [
        "item-drop",
        "meso-drop",
        "normal-damage"
      ]
    },
    "rankings": {
      "boss": {
        "main": [
          {
            "type": "boss-damage",
            "count": 1000,
            "rate": 100
          },
          {
            "type": "int",
            "count": 13,
            "rate": 1.3
          },
          {
            "type": "str",
            "count": 11,
            "rate": 1.1
          },
          {
            "type": "cooldown-skip",
            "count": 8,
            "rate": 0.8
          },
          {
            "type": "dex",
            "count": 8,
            "rate": 0.8
          },
          {
            "type": "luk-int",
            "count": 8,
            "rate": 0.8
          },
          {
            "type": "passive-level",
            "count": 8,
            "rate": 0.8
          },
          {
            "type": "max-hp",
            "count": 7,
            "rate": 0.7
          }
        ],
        "sub": [
          {
            "type": "abnormal-damage",
            "count": 982,
            "rate": 98.2
          },
          {
            "type": "critical",
            "count": 964,
            "rate": 96.4
          },
          {
            "type": "attack",
            "count": 111,
            "rate": 11.1
          },
          {
            "type": "buff-duration",
            "count": 16,
            "rate": 1.6
          },
          {
            "type": "cooldown-skip",
            "count": 12,
            "rate": 1.2
          },
          {
            "type": "max-mp",
            "count": 12,
            "rate": 1.2
          },
          {
            "type": "boss-damage",
            "count": 11,
            "rate": 1.1
          },
          {
            "type": "dex",
            "count": 11,
            "rate": 1.1
          },
          {
            "type": "dex-luk",
            "count": 10,
            "rate": 1
          },
          {
            "type": "all-stat",
            "count": 9,
            "rate": 0.9
          },
          {
            "type": "dex-int",
            "count": 7,
            "rate": 0.7
          },
          {
            "type": "luk",
            "count": 7,
            "rate": 0.7
          }
        ]
      },
      "hunt": {
        "main": [
          {
            "type": "item-drop",
            "count": 933,
            "rate": 93.3
          },
          {
            "type": "meso-drop",
            "count": 563,
            "rate": 56.3
          },
          {
            "type": "normal-damage",
            "count": 9,
            "rate": 0.9
          }
        ],
        "sub": [
          {
            "type": "meso-drop",
            "count": 744,
            "rate": 74.4
          },
          {
            "type": "normal-damage",
            "count": 672,
            "rate": 67.2
          },
          {
            "type": "item-drop",
            "count": 567,
            "rate": 56.7
          }
        ]
      }
    }
  },
  {
    "id": "블래스터",
    "name": "블래스터",
    "samples": 1000,
    "presets": {
      "boss": [
        "boss-damage",
        "abnormal-damage",
        "attack"
      ],
      "hunt": [
        "item-drop",
        "meso-drop",
        "normal-damage"
      ]
    },
    "rankings": {
      "boss": {
        "main": [
          {
            "type": "boss-damage",
            "count": 997,
            "rate": 99.7
          },
          {
            "type": "passive-level",
            "count": 25,
            "rate": 2.5
          },
          {
            "type": "cooldown-skip",
            "count": 12,
            "rate": 1.2
          },
          {
            "type": "str",
            "count": 12,
            "rate": 1.2
          },
          {
            "type": "dex-str",
            "count": 10,
            "rate": 1
          },
          {
            "type": "attack",
            "count": 9,
            "rate": 0.9
          },
          {
            "type": "dex-int",
            "count": 9,
            "rate": 0.9
          },
          {
            "type": "int",
            "count": 9,
            "rate": 0.9
          }
        ],
        "sub": [
          {
            "type": "abnormal-damage",
            "count": 979,
            "rate": 97.9
          },
          {
            "type": "attack",
            "count": 892,
            "rate": 89.2
          },
          {
            "type": "buff-duration",
            "count": 92,
            "rate": 9.2
          },
          {
            "type": "boss-damage",
            "count": 31,
            "rate": 3.1
          },
          {
            "type": "cooldown-skip",
            "count": 18,
            "rate": 1.8
          },
          {
            "type": "str",
            "count": 17,
            "rate": 1.7
          },
          {
            "type": "critical",
            "count": 16,
            "rate": 1.6
          },
          {
            "type": "int-str",
            "count": 9,
            "rate": 0.9
          },
          {
            "type": "int",
            "count": 8,
            "rate": 0.8
          },
          {
            "type": "int-dex",
            "count": 8,
            "rate": 0.8
          },
          {
            "type": "max-mp",
            "count": 8,
            "rate": 0.8
          },
          {
            "type": "str-dex",
            "count": 8,
            "rate": 0.8
          }
        ]
      },
      "hunt": {
        "main": [
          {
            "type": "item-drop",
            "count": 919,
            "rate": 91.9
          },
          {
            "type": "meso-drop",
            "count": 453,
            "rate": 45.3
          },
          {
            "type": "normal-damage",
            "count": 14,
            "rate": 1.4
          }
        ],
        "sub": [
          {
            "type": "meso-drop",
            "count": 715,
            "rate": 71.5
          },
          {
            "type": "normal-damage",
            "count": 500,
            "rate": 50
          },
          {
            "type": "item-drop",
            "count": 435,
            "rate": 43.5
          }
        ]
      }
    }
  },
  {
    "id": "비숍",
    "name": "비숍",
    "samples": 1000,
    "presets": {
      "boss": [
        "boss-damage",
        "abnormal-damage",
        "magic"
      ],
      "hunt": [
        "item-drop",
        "meso-drop",
        "normal-damage"
      ]
    },
    "rankings": {
      "boss": {
        "main": [
          {
            "type": "boss-damage",
            "count": 997,
            "rate": 99.7
          },
          {
            "type": "buff-duration",
            "count": 156,
            "rate": 15.6
          },
          {
            "type": "cooldown-skip",
            "count": 6,
            "rate": 0.6
          },
          {
            "type": "attack",
            "count": 3,
            "rate": 0.3
          },
          {
            "type": "int",
            "count": 3,
            "rate": 0.3
          },
          {
            "type": "int-str",
            "count": 3,
            "rate": 0.3
          },
          {
            "type": "luk",
            "count": 3,
            "rate": 0.3
          },
          {
            "type": "dex-int",
            "count": 2,
            "rate": 0.2
          }
        ],
        "sub": [
          {
            "type": "abnormal-damage",
            "count": 996,
            "rate": 99.6
          },
          {
            "type": "magic",
            "count": 863,
            "rate": 86.3
          },
          {
            "type": "buff-duration",
            "count": 610,
            "rate": 61
          },
          {
            "type": "boss-damage",
            "count": 140,
            "rate": 14
          },
          {
            "type": "int",
            "count": 14,
            "rate": 1.4
          },
          {
            "type": "cooldown-skip",
            "count": 12,
            "rate": 1.2
          },
          {
            "type": "int-luk",
            "count": 5,
            "rate": 0.5
          },
          {
            "type": "luk",
            "count": 5,
            "rate": 0.5
          },
          {
            "type": "all-stat",
            "count": 4,
            "rate": 0.4
          },
          {
            "type": "ap-dex-to-str",
            "count": 4,
            "rate": 0.4
          },
          {
            "type": "luk-dex",
            "count": 4,
            "rate": 0.4
          },
          {
            "type": "str",
            "count": 4,
            "rate": 0.4
          }
        ]
      },
      "hunt": {
        "main": [
          {
            "type": "item-drop",
            "count": 963,
            "rate": 96.3
          },
          {
            "type": "meso-drop",
            "count": 460,
            "rate": 46
          },
          {
            "type": "normal-damage",
            "count": 2,
            "rate": 0.2
          }
        ],
        "sub": [
          {
            "type": "meso-drop",
            "count": 842,
            "rate": 84.2
          },
          {
            "type": "item-drop",
            "count": 473,
            "rate": 47.3
          },
          {
            "type": "normal-damage",
            "count": 472,
            "rate": 47.2
          }
        ]
      }
    }
  },
  {
    "id": "섀도어",
    "name": "섀도어",
    "samples": 1000,
    "presets": {
      "boss": [
        "boss-damage",
        "abnormal-damage",
        "attack"
      ],
      "hunt": [
        "item-drop",
        "normal-damage",
        "meso-drop"
      ]
    },
    "rankings": {
      "boss": {
        "main": [
          {
            "type": "boss-damage",
            "count": 998,
            "rate": 99.8
          },
          {
            "type": "cooldown-skip",
            "count": 124,
            "rate": 12.4
          },
          {
            "type": "int-dex",
            "count": 7,
            "rate": 0.7
          },
          {
            "type": "dex",
            "count": 6,
            "rate": 0.6
          },
          {
            "type": "dex-str",
            "count": 5,
            "rate": 0.5
          },
          {
            "type": "luk-int",
            "count": 5,
            "rate": 0.5
          },
          {
            "type": "str-int",
            "count": 5,
            "rate": 0.5
          },
          {
            "type": "dex-int",
            "count": 4,
            "rate": 0.4
          }
        ],
        "sub": [
          {
            "type": "abnormal-damage",
            "count": 996,
            "rate": 99.6
          },
          {
            "type": "attack",
            "count": 892,
            "rate": 89.2
          },
          {
            "type": "buff-duration",
            "count": 157,
            "rate": 15.7
          },
          {
            "type": "cooldown-skip",
            "count": 139,
            "rate": 13.9
          },
          {
            "type": "boss-damage",
            "count": 127,
            "rate": 12.7
          },
          {
            "type": "critical",
            "count": 11,
            "rate": 1.1
          },
          {
            "type": "luk",
            "count": 10,
            "rate": 1
          },
          {
            "type": "all-stat",
            "count": 7,
            "rate": 0.7
          },
          {
            "type": "dex",
            "count": 6,
            "rate": 0.6
          },
          {
            "type": "dex-str",
            "count": 5,
            "rate": 0.5
          },
          {
            "type": "int-luk",
            "count": 5,
            "rate": 0.5
          },
          {
            "type": "dex-luk",
            "count": 4,
            "rate": 0.4
          }
        ]
      },
      "hunt": {
        "main": [
          {
            "type": "item-drop",
            "count": 937,
            "rate": 93.7
          },
          {
            "type": "meso-drop",
            "count": 573,
            "rate": 57.3
          },
          {
            "type": "normal-damage",
            "count": 3,
            "rate": 0.3
          }
        ],
        "sub": [
          {
            "type": "normal-damage",
            "count": 752,
            "rate": 75.2
          },
          {
            "type": "meso-drop",
            "count": 749,
            "rate": 74.9
          },
          {
            "type": "item-drop",
            "count": 566,
            "rate": 56.6
          }
        ]
      }
    }
  },
  {
    "id": "소울마스터",
    "name": "소울마스터",
    "samples": 1000,
    "presets": {
      "boss": [
        "boss-damage",
        "abnormal-damage",
        "attack"
      ],
      "hunt": [
        "item-drop",
        "meso-drop",
        "normal-damage"
      ]
    },
    "rankings": {
      "boss": {
        "main": [
          {
            "type": "boss-damage",
            "count": 1000,
            "rate": 100
          },
          {
            "type": "attack",
            "count": 8,
            "rate": 0.8
          },
          {
            "type": "luk",
            "count": 8,
            "rate": 0.8
          },
          {
            "type": "str",
            "count": 7,
            "rate": 0.7
          },
          {
            "type": "ap-dex-to-str",
            "count": 6,
            "rate": 0.6
          },
          {
            "type": "cooldown-skip",
            "count": 6,
            "rate": 0.6
          },
          {
            "type": "dex-luk",
            "count": 5,
            "rate": 0.5
          },
          {
            "type": "buff-duration",
            "count": 4,
            "rate": 0.4
          }
        ],
        "sub": [
          {
            "type": "abnormal-damage",
            "count": 989,
            "rate": 98.9
          },
          {
            "type": "attack",
            "count": 797,
            "rate": 79.7
          },
          {
            "type": "buff-duration",
            "count": 336,
            "rate": 33.6
          },
          {
            "type": "critical",
            "count": 123,
            "rate": 12.3
          },
          {
            "type": "str",
            "count": 19,
            "rate": 1.9
          },
          {
            "type": "cooldown-skip",
            "count": 16,
            "rate": 1.6
          },
          {
            "type": "boss-damage",
            "count": 9,
            "rate": 0.9
          },
          {
            "type": "all-stat",
            "count": 7,
            "rate": 0.7
          },
          {
            "type": "luk",
            "count": 6,
            "rate": 0.6
          },
          {
            "type": "luk-dex",
            "count": 6,
            "rate": 0.6
          },
          {
            "type": "int-str",
            "count": 4,
            "rate": 0.4
          },
          {
            "type": "max-hp",
            "count": 4,
            "rate": 0.4
          }
        ]
      },
      "hunt": {
        "main": [
          {
            "type": "item-drop",
            "count": 957,
            "rate": 95.7
          },
          {
            "type": "meso-drop",
            "count": 458,
            "rate": 45.8
          },
          {
            "type": "normal-damage",
            "count": 5,
            "rate": 0.5
          }
        ],
        "sub": [
          {
            "type": "meso-drop",
            "count": 829,
            "rate": 82.9
          },
          {
            "type": "normal-damage",
            "count": 640,
            "rate": 64
          },
          {
            "type": "item-drop",
            "count": 451,
            "rate": 45.1
          }
        ]
      }
    }
  },
  {
    "id": "스트라이커",
    "name": "스트라이커",
    "samples": 1000,
    "presets": {
      "boss": [
        "boss-damage",
        "abnormal-damage",
        "attack"
      ],
      "hunt": [
        "item-drop",
        "meso-drop",
        "normal-damage"
      ]
    },
    "rankings": {
      "boss": {
        "main": [
          {
            "type": "boss-damage",
            "count": 767,
            "rate": 76.7
          },
          {
            "type": "passive-level",
            "count": 533,
            "rate": 53.3
          },
          {
            "type": "int-str",
            "count": 11,
            "rate": 1.1
          },
          {
            "type": "int",
            "count": 9,
            "rate": 0.9
          },
          {
            "type": "str-dex",
            "count": 9,
            "rate": 0.9
          },
          {
            "type": "luk-int",
            "count": 8,
            "rate": 0.8
          },
          {
            "type": "dex-int",
            "count": 7,
            "rate": 0.7
          },
          {
            "type": "luk",
            "count": 7,
            "rate": 0.7
          }
        ],
        "sub": [
          {
            "type": "abnormal-damage",
            "count": 975,
            "rate": 97.5
          },
          {
            "type": "attack",
            "count": 613,
            "rate": 61.3
          },
          {
            "type": "boss-damage",
            "count": 494,
            "rate": 49.4
          },
          {
            "type": "buff-duration",
            "count": 131,
            "rate": 13.1
          },
          {
            "type": "critical",
            "count": 89,
            "rate": 8.9
          },
          {
            "type": "cooldown-skip",
            "count": 27,
            "rate": 2.7
          },
          {
            "type": "str",
            "count": 10,
            "rate": 1
          },
          {
            "type": "str-dex",
            "count": 9,
            "rate": 0.9
          },
          {
            "type": "dex-int",
            "count": 7,
            "rate": 0.7
          },
          {
            "type": "int-luk",
            "count": 7,
            "rate": 0.7
          },
          {
            "type": "str-int",
            "count": 7,
            "rate": 0.7
          },
          {
            "type": "all-stat",
            "count": 6,
            "rate": 0.6
          }
        ]
      },
      "hunt": {
        "main": [
          {
            "type": "item-drop",
            "count": 869,
            "rate": 86.9
          },
          {
            "type": "meso-drop",
            "count": 365,
            "rate": 36.5
          },
          {
            "type": "normal-damage",
            "count": 11,
            "rate": 1.1
          }
        ],
        "sub": [
          {
            "type": "meso-drop",
            "count": 692,
            "rate": 69.2
          },
          {
            "type": "normal-damage",
            "count": 441,
            "rate": 44.1
          },
          {
            "type": "item-drop",
            "count": 344,
            "rate": 34.4
          }
        ]
      }
    }
  },
  {
    "id": "신궁",
    "name": "신궁",
    "samples": 1000,
    "presets": {
      "boss": [
        "boss-damage",
        "abnormal-damage",
        "critical"
      ],
      "hunt": [
        "item-drop",
        "meso-drop",
        "normal-damage"
      ]
    },
    "rankings": {
      "boss": {
        "main": [
          {
            "type": "boss-damage",
            "count": 993,
            "rate": 99.3
          },
          {
            "type": "cooldown-skip",
            "count": 12,
            "rate": 1.2
          },
          {
            "type": "buff-duration",
            "count": 11,
            "rate": 1.1
          },
          {
            "type": "passive-level",
            "count": 10,
            "rate": 1
          },
          {
            "type": "str",
            "count": 10,
            "rate": 1
          },
          {
            "type": "critical",
            "count": 9,
            "rate": 0.9
          },
          {
            "type": "dex",
            "count": 9,
            "rate": 0.9
          },
          {
            "type": "max-mp",
            "count": 9,
            "rate": 0.9
          }
        ],
        "sub": [
          {
            "type": "abnormal-damage",
            "count": 944,
            "rate": 94.4
          },
          {
            "type": "critical",
            "count": 858,
            "rate": 85.8
          },
          {
            "type": "attack",
            "count": 127,
            "rate": 12.7
          },
          {
            "type": "buff-duration",
            "count": 31,
            "rate": 3.1
          },
          {
            "type": "boss-damage",
            "count": 26,
            "rate": 2.6
          },
          {
            "type": "dex",
            "count": 15,
            "rate": 1.5
          },
          {
            "type": "dex-int",
            "count": 12,
            "rate": 1.2
          },
          {
            "type": "dex-luk",
            "count": 10,
            "rate": 1
          },
          {
            "type": "dex-str",
            "count": 10,
            "rate": 1
          },
          {
            "type": "int-dex",
            "count": 9,
            "rate": 0.9
          },
          {
            "type": "str-int",
            "count": 9,
            "rate": 0.9
          },
          {
            "type": "int-str",
            "count": 8,
            "rate": 0.8
          }
        ]
      },
      "hunt": {
        "main": [
          {
            "type": "item-drop",
            "count": 876,
            "rate": 87.6
          },
          {
            "type": "meso-drop",
            "count": 435,
            "rate": 43.5
          },
          {
            "type": "normal-damage",
            "count": 16,
            "rate": 1.6
          }
        ],
        "sub": [
          {
            "type": "meso-drop",
            "count": 686,
            "rate": 68.6
          },
          {
            "type": "normal-damage",
            "count": 499,
            "rate": 49.9
          },
          {
            "type": "item-drop",
            "count": 416,
            "rate": 41.6
          }
        ]
      }
    }
  },
  {
    "id": "아델",
    "name": "아델",
    "samples": 1000,
    "presets": {
      "boss": [
        "boss-damage",
        "abnormal-damage",
        "cooldown-skip"
      ],
      "hunt": [
        "item-drop",
        "meso-drop",
        "normal-damage"
      ]
    },
    "rankings": {
      "boss": {
        "main": [
          {
            "type": "boss-damage",
            "count": 939,
            "rate": 93.9
          },
          {
            "type": "cooldown-skip",
            "count": 584,
            "rate": 58.4
          },
          {
            "type": "magic",
            "count": 6,
            "rate": 0.6
          },
          {
            "type": "luk",
            "count": 5,
            "rate": 0.5
          },
          {
            "type": "dex-luk",
            "count": 4,
            "rate": 0.4
          },
          {
            "type": "int-dex",
            "count": 4,
            "rate": 0.4
          },
          {
            "type": "str-int",
            "count": 4,
            "rate": 0.4
          },
          {
            "type": "ap-luk-to-dex",
            "count": 3,
            "rate": 0.3
          }
        ],
        "sub": [
          {
            "type": "abnormal-damage",
            "count": 993,
            "rate": 99.3
          },
          {
            "type": "cooldown-skip",
            "count": 924,
            "rate": 92.4
          },
          {
            "type": "boss-damage",
            "count": 572,
            "rate": 57.2
          },
          {
            "type": "attack",
            "count": 68,
            "rate": 6.8
          },
          {
            "type": "buff-duration",
            "count": 35,
            "rate": 3.5
          },
          {
            "type": "critical",
            "count": 25,
            "rate": 2.5
          },
          {
            "type": "str",
            "count": 8,
            "rate": 0.8
          },
          {
            "type": "all-stat",
            "count": 4,
            "rate": 0.4
          },
          {
            "type": "int-dex",
            "count": 4,
            "rate": 0.4
          },
          {
            "type": "str-dex",
            "count": 4,
            "rate": 0.4
          },
          {
            "type": "str-luk",
            "count": 4,
            "rate": 0.4
          },
          {
            "type": "ap-luk-to-dex",
            "count": 3,
            "rate": 0.3
          }
        ]
      },
      "hunt": {
        "main": [
          {
            "type": "item-drop",
            "count": 943,
            "rate": 94.3
          },
          {
            "type": "meso-drop",
            "count": 374,
            "rate": 37.4
          },
          {
            "type": "normal-damage",
            "count": 4,
            "rate": 0.4
          }
        ],
        "sub": [
          {
            "type": "meso-drop",
            "count": 867,
            "rate": 86.7
          },
          {
            "type": "normal-damage",
            "count": 755,
            "rate": 75.5
          },
          {
            "type": "item-drop",
            "count": 375,
            "rate": 37.5
          }
        ]
      }
    }
  },
  {
    "id": "아란",
    "name": "아란",
    "samples": 1000,
    "presets": {
      "boss": [
        "boss-damage",
        "abnormal-damage",
        "attack"
      ],
      "hunt": [
        "item-drop",
        "meso-drop",
        "normal-damage"
      ]
    },
    "rankings": {
      "boss": {
        "main": [
          {
            "type": "boss-damage",
            "count": 997,
            "rate": 99.7
          },
          {
            "type": "buff-duration",
            "count": 27,
            "rate": 2.7
          },
          {
            "type": "cooldown-skip",
            "count": 18,
            "rate": 1.8
          },
          {
            "type": "dex",
            "count": 7,
            "rate": 0.7
          },
          {
            "type": "dex-luk",
            "count": 7,
            "rate": 0.7
          },
          {
            "type": "luk",
            "count": 7,
            "rate": 0.7
          },
          {
            "type": "str-int",
            "count": 7,
            "rate": 0.7
          },
          {
            "type": "attack",
            "count": 6,
            "rate": 0.6
          }
        ],
        "sub": [
          {
            "type": "abnormal-damage",
            "count": 983,
            "rate": 98.3
          },
          {
            "type": "attack",
            "count": 860,
            "rate": 86
          },
          {
            "type": "buff-duration",
            "count": 255,
            "rate": 25.5
          },
          {
            "type": "critical",
            "count": 65,
            "rate": 6.5
          },
          {
            "type": "cooldown-skip",
            "count": 17,
            "rate": 1.7
          },
          {
            "type": "str",
            "count": 14,
            "rate": 1.4
          },
          {
            "type": "boss-damage",
            "count": 13,
            "rate": 1.3
          },
          {
            "type": "all-stat",
            "count": 10,
            "rate": 1
          },
          {
            "type": "ap-int-to-luk",
            "count": 8,
            "rate": 0.8
          },
          {
            "type": "int",
            "count": 7,
            "rate": 0.7
          },
          {
            "type": "max-hp",
            "count": 7,
            "rate": 0.7
          },
          {
            "type": "str-int",
            "count": 7,
            "rate": 0.7
          }
        ]
      },
      "hunt": {
        "main": [
          {
            "type": "item-drop",
            "count": 937,
            "rate": 93.7
          },
          {
            "type": "meso-drop",
            "count": 434,
            "rate": 43.4
          },
          {
            "type": "normal-damage",
            "count": 12,
            "rate": 1.2
          }
        ],
        "sub": [
          {
            "type": "meso-drop",
            "count": 786,
            "rate": 78.6
          },
          {
            "type": "normal-damage",
            "count": 629,
            "rate": 62.9
          },
          {
            "type": "item-drop",
            "count": 419,
            "rate": 41.9
          }
        ]
      }
    }
  },
  {
    "id": "아크",
    "name": "아크",
    "samples": 1000,
    "presets": {
      "boss": [
        "cooldown-skip",
        "abnormal-damage",
        "boss-damage"
      ],
      "hunt": [
        "item-drop",
        "meso-drop",
        "normal-damage"
      ]
    },
    "rankings": {
      "boss": {
        "main": [
          {
            "type": "cooldown-skip",
            "count": 886,
            "rate": 88.6
          },
          {
            "type": "boss-damage",
            "count": 567,
            "rate": 56.7
          },
          {
            "type": "passive-level",
            "count": 106,
            "rate": 10.6
          },
          {
            "type": "str-luk",
            "count": 8,
            "rate": 0.8
          },
          {
            "type": "ap-luk-to-dex",
            "count": 5,
            "rate": 0.5
          },
          {
            "type": "dex-str",
            "count": 5,
            "rate": 0.5
          },
          {
            "type": "luk-dex",
            "count": 5,
            "rate": 0.5
          },
          {
            "type": "str",
            "count": 5,
            "rate": 0.5
          }
        ],
        "sub": [
          {
            "type": "abnormal-damage",
            "count": 995,
            "rate": 99.5
          },
          {
            "type": "boss-damage",
            "count": 895,
            "rate": 89.5
          },
          {
            "type": "attack",
            "count": 397,
            "rate": 39.7
          },
          {
            "type": "buff-duration",
            "count": 157,
            "rate": 15.7
          },
          {
            "type": "critical",
            "count": 54,
            "rate": 5.4
          },
          {
            "type": "cooldown-skip",
            "count": 47,
            "rate": 4.7
          },
          {
            "type": "str-int",
            "count": 8,
            "rate": 0.8
          },
          {
            "type": "max-mp",
            "count": 6,
            "rate": 0.6
          },
          {
            "type": "str-dex",
            "count": 6,
            "rate": 0.6
          },
          {
            "type": "all-stat",
            "count": 5,
            "rate": 0.5
          },
          {
            "type": "dex-int",
            "count": 4,
            "rate": 0.4
          },
          {
            "type": "int-dex",
            "count": 4,
            "rate": 0.4
          }
        ]
      },
      "hunt": {
        "main": [
          {
            "type": "item-drop",
            "count": 937,
            "rate": 93.7
          },
          {
            "type": "meso-drop",
            "count": 284,
            "rate": 28.4
          },
          {
            "type": "normal-damage",
            "count": 5,
            "rate": 0.5
          }
        ],
        "sub": [
          {
            "type": "meso-drop",
            "count": 854,
            "rate": 85.4
          },
          {
            "type": "normal-damage",
            "count": 628,
            "rate": 62.8
          },
          {
            "type": "item-drop",
            "count": 289,
            "rate": 28.9
          }
        ]
      }
    }
  },
  {
    "id": "아크메이지(불,독)",
    "name": "아크메이지(불,독)",
    "samples": 1000,
    "presets": {
      "boss": [
        "boss-damage",
        "abnormal-damage",
        "buff-duration"
      ],
      "hunt": [
        "item-drop",
        "meso-drop",
        "normal-damage"
      ]
    },
    "rankings": {
      "boss": {
        "main": [
          {
            "type": "boss-damage",
            "count": 996,
            "rate": 99.6
          },
          {
            "type": "buff-duration",
            "count": 154,
            "rate": 15.4
          },
          {
            "type": "cooldown-skip",
            "count": 7,
            "rate": 0.7
          },
          {
            "type": "max-hp",
            "count": 6,
            "rate": 0.6
          },
          {
            "type": "str",
            "count": 6,
            "rate": 0.6
          },
          {
            "type": "max-mp",
            "count": 5,
            "rate": 0.5
          },
          {
            "type": "int-dex",
            "count": 4,
            "rate": 0.4
          },
          {
            "type": "luk",
            "count": 4,
            "rate": 0.4
          }
        ],
        "sub": [
          {
            "type": "abnormal-damage",
            "count": 999,
            "rate": 99.9
          },
          {
            "type": "buff-duration",
            "count": 814,
            "rate": 81.4
          },
          {
            "type": "magic",
            "count": 732,
            "rate": 73.2
          },
          {
            "type": "boss-damage",
            "count": 117,
            "rate": 11.7
          },
          {
            "type": "critical",
            "count": 66,
            "rate": 6.6
          },
          {
            "type": "all-stat",
            "count": 9,
            "rate": 0.9
          },
          {
            "type": "int",
            "count": 8,
            "rate": 0.8
          },
          {
            "type": "cooldown-skip",
            "count": 7,
            "rate": 0.7
          },
          {
            "type": "luk",
            "count": 7,
            "rate": 0.7
          },
          {
            "type": "dex-luk",
            "count": 5,
            "rate": 0.5
          },
          {
            "type": "dex-str",
            "count": 5,
            "rate": 0.5
          },
          {
            "type": "int-str",
            "count": 5,
            "rate": 0.5
          }
        ]
      },
      "hunt": {
        "main": [
          {
            "type": "item-drop",
            "count": 944,
            "rate": 94.4
          },
          {
            "type": "meso-drop",
            "count": 335,
            "rate": 33.5
          },
          {
            "type": "normal-damage",
            "count": 2,
            "rate": 0.2
          }
        ],
        "sub": [
          {
            "type": "meso-drop",
            "count": 839,
            "rate": 83.9
          },
          {
            "type": "normal-damage",
            "count": 433,
            "rate": 43.3
          },
          {
            "type": "item-drop",
            "count": 350,
            "rate": 35
          }
        ]
      }
    }
  },
  {
    "id": "아크메이지(썬,콜)",
    "name": "아크메이지(썬,콜)",
    "samples": 1000,
    "presets": {
      "boss": [
        "boss-damage",
        "abnormal-damage",
        "magic"
      ],
      "hunt": [
        "item-drop",
        "meso-drop",
        "normal-damage"
      ]
    },
    "rankings": {
      "boss": {
        "main": [
          {
            "type": "boss-damage",
            "count": 995,
            "rate": 99.5
          },
          {
            "type": "buff-duration",
            "count": 186,
            "rate": 18.6
          },
          {
            "type": "dex-int",
            "count": 6,
            "rate": 0.6
          },
          {
            "type": "magic",
            "count": 6,
            "rate": 0.6
          },
          {
            "type": "cooldown-skip",
            "count": 4,
            "rate": 0.4
          },
          {
            "type": "dex-str",
            "count": 4,
            "rate": 0.4
          },
          {
            "type": "int-luk",
            "count": 4,
            "rate": 0.4
          },
          {
            "type": "luk",
            "count": 4,
            "rate": 0.4
          }
        ],
        "sub": [
          {
            "type": "abnormal-damage",
            "count": 986,
            "rate": 98.6
          },
          {
            "type": "magic",
            "count": 938,
            "rate": 93.8
          },
          {
            "type": "buff-duration",
            "count": 384,
            "rate": 38.4
          },
          {
            "type": "boss-damage",
            "count": 142,
            "rate": 14.2
          },
          {
            "type": "critical",
            "count": 97,
            "rate": 9.7
          },
          {
            "type": "int",
            "count": 15,
            "rate": 1.5
          },
          {
            "type": "cooldown-skip",
            "count": 14,
            "rate": 1.4
          },
          {
            "type": "all-stat",
            "count": 11,
            "rate": 1.1
          },
          {
            "type": "int-dex",
            "count": 9,
            "rate": 0.9
          },
          {
            "type": "dex-str",
            "count": 6,
            "rate": 0.6
          },
          {
            "type": "dex-int",
            "count": 5,
            "rate": 0.5
          },
          {
            "type": "int-str",
            "count": 5,
            "rate": 0.5
          }
        ]
      },
      "hunt": {
        "main": [
          {
            "type": "item-drop",
            "count": 936,
            "rate": 93.6
          },
          {
            "type": "meso-drop",
            "count": 459,
            "rate": 45.9
          },
          {
            "type": "normal-damage",
            "count": 3,
            "rate": 0.3
          }
        ],
        "sub": [
          {
            "type": "meso-drop",
            "count": 802,
            "rate": 80.2
          },
          {
            "type": "normal-damage",
            "count": 488,
            "rate": 48.8
          },
          {
            "type": "item-drop",
            "count": 467,
            "rate": 46.7
          }
        ]
      }
    }
  },
  {
    "id": "에반",
    "name": "에반",
    "samples": 1000,
    "presets": {
      "boss": [
        "boss-damage",
        "abnormal-damage",
        "cooldown-skip"
      ],
      "hunt": [
        "item-drop",
        "meso-drop",
        "normal-damage"
      ]
    },
    "rankings": {
      "boss": {
        "main": [
          {
            "type": "boss-damage",
            "count": 951,
            "rate": 95.1
          },
          {
            "type": "cooldown-skip",
            "count": 593,
            "rate": 59.3
          },
          {
            "type": "str-dex",
            "count": 6,
            "rate": 0.6
          },
          {
            "type": "dex-luk",
            "count": 5,
            "rate": 0.5
          },
          {
            "type": "dex-str",
            "count": 5,
            "rate": 0.5
          },
          {
            "type": "ap-int-to-luk",
            "count": 4,
            "rate": 0.4
          },
          {
            "type": "dex",
            "count": 4,
            "rate": 0.4
          },
          {
            "type": "str-luk",
            "count": 4,
            "rate": 0.4
          }
        ],
        "sub": [
          {
            "type": "abnormal-damage",
            "count": 986,
            "rate": 98.6
          },
          {
            "type": "cooldown-skip",
            "count": 888,
            "rate": 88.8
          },
          {
            "type": "boss-damage",
            "count": 576,
            "rate": 57.6
          },
          {
            "type": "magic",
            "count": 152,
            "rate": 15.2
          },
          {
            "type": "critical",
            "count": 30,
            "rate": 3
          },
          {
            "type": "int",
            "count": 16,
            "rate": 1.6
          },
          {
            "type": "buff-duration",
            "count": 12,
            "rate": 1.2
          },
          {
            "type": "all-stat",
            "count": 5,
            "rate": 0.5
          },
          {
            "type": "dex-str",
            "count": 4,
            "rate": 0.4
          },
          {
            "type": "int-dex",
            "count": 4,
            "rate": 0.4
          },
          {
            "type": "str-dex",
            "count": 4,
            "rate": 0.4
          },
          {
            "type": "defense-damage",
            "count": 3,
            "rate": 0.3
          }
        ]
      },
      "hunt": {
        "main": [
          {
            "type": "item-drop",
            "count": 904,
            "rate": 90.4
          },
          {
            "type": "meso-drop",
            "count": 306,
            "rate": 30.6
          },
          {
            "type": "normal-damage",
            "count": 7,
            "rate": 0.7
          }
        ],
        "sub": [
          {
            "type": "meso-drop",
            "count": 791,
            "rate": 79.1
          },
          {
            "type": "normal-damage",
            "count": 585,
            "rate": 58.5
          },
          {
            "type": "item-drop",
            "count": 305,
            "rate": 30.5
          }
        ]
      }
    }
  },
  {
    "id": "엔젤릭버스터",
    "name": "엔젤릭버스터",
    "samples": 1000,
    "presets": {
      "boss": [
        "boss-damage",
        "abnormal-damage",
        "buff-duration"
      ],
      "hunt": [
        "item-drop",
        "meso-drop",
        "normal-damage"
      ]
    },
    "rankings": {
      "boss": {
        "main": [
          {
            "type": "boss-damage",
            "count": 997,
            "rate": 99.7
          },
          {
            "type": "cooldown-skip",
            "count": 12,
            "rate": 1.2
          },
          {
            "type": "multi-target",
            "count": 12,
            "rate": 1.2
          },
          {
            "type": "luk",
            "count": 8,
            "rate": 0.8
          },
          {
            "type": "str",
            "count": 8,
            "rate": 0.8
          },
          {
            "type": "luk-str",
            "count": 7,
            "rate": 0.7
          },
          {
            "type": "dex-luk",
            "count": 5,
            "rate": 0.5
          },
          {
            "type": "int-str",
            "count": 5,
            "rate": 0.5
          }
        ],
        "sub": [
          {
            "type": "abnormal-damage",
            "count": 985,
            "rate": 98.5
          },
          {
            "type": "buff-duration",
            "count": 658,
            "rate": 65.8
          },
          {
            "type": "attack",
            "count": 580,
            "rate": 58
          },
          {
            "type": "critical",
            "count": 124,
            "rate": 12.4
          },
          {
            "type": "cooldown-skip",
            "count": 23,
            "rate": 2.3
          },
          {
            "type": "dex",
            "count": 11,
            "rate": 1.1
          },
          {
            "type": "all-stat",
            "count": 9,
            "rate": 0.9
          },
          {
            "type": "boss-damage",
            "count": 9,
            "rate": 0.9
          },
          {
            "type": "dex-luk",
            "count": 9,
            "rate": 0.9
          },
          {
            "type": "max-mp",
            "count": 9,
            "rate": 0.9
          },
          {
            "type": "luk-str",
            "count": 8,
            "rate": 0.8
          },
          {
            "type": "dex-int",
            "count": 7,
            "rate": 0.7
          }
        ]
      },
      "hunt": {
        "main": [
          {
            "type": "item-drop",
            "count": 926,
            "rate": 92.6
          },
          {
            "type": "meso-drop",
            "count": 493,
            "rate": 49.3
          },
          {
            "type": "normal-damage",
            "count": 12,
            "rate": 1.2
          }
        ],
        "sub": [
          {
            "type": "meso-drop",
            "count": 762,
            "rate": 76.2
          },
          {
            "type": "normal-damage",
            "count": 636,
            "rate": 63.6
          },
          {
            "type": "item-drop",
            "count": 497,
            "rate": 49.7
          }
        ]
      }
    }
  },
  {
    "id": "와일드헌터",
    "name": "와일드헌터",
    "samples": 1000,
    "presets": {
      "boss": [
        "boss-damage",
        "abnormal-damage",
        "critical"
      ],
      "hunt": [
        "item-drop",
        "meso-drop",
        "normal-damage"
      ]
    },
    "rankings": {
      "boss": {
        "main": [
          {
            "type": "boss-damage",
            "count": 989,
            "rate": 98.9
          },
          {
            "type": "cooldown-skip",
            "count": 72,
            "rate": 7.2
          },
          {
            "type": "buff-duration",
            "count": 23,
            "rate": 2.3
          },
          {
            "type": "luk",
            "count": 18,
            "rate": 1.8
          },
          {
            "type": "dex-luk",
            "count": 13,
            "rate": 1.3
          },
          {
            "type": "int",
            "count": 13,
            "rate": 1.3
          },
          {
            "type": "attack",
            "count": 10,
            "rate": 1
          },
          {
            "type": "dex",
            "count": 10,
            "rate": 1
          }
        ],
        "sub": [
          {
            "type": "abnormal-damage",
            "count": 922,
            "rate": 92.2
          },
          {
            "type": "critical",
            "count": 747,
            "rate": 74.7
          },
          {
            "type": "attack",
            "count": 133,
            "rate": 13.3
          },
          {
            "type": "boss-damage",
            "count": 63,
            "rate": 6.3
          },
          {
            "type": "cooldown-skip",
            "count": 48,
            "rate": 4.8
          },
          {
            "type": "buff-duration",
            "count": 46,
            "rate": 4.6
          },
          {
            "type": "dex",
            "count": 18,
            "rate": 1.8
          },
          {
            "type": "dex-str",
            "count": 14,
            "rate": 1.4
          },
          {
            "type": "all-stat",
            "count": 12,
            "rate": 1.2
          },
          {
            "type": "int-str",
            "count": 12,
            "rate": 1.2
          },
          {
            "type": "dex-int",
            "count": 11,
            "rate": 1.1
          },
          {
            "type": "str",
            "count": 11,
            "rate": 1.1
          }
        ]
      },
      "hunt": {
        "main": [
          {
            "type": "item-drop",
            "count": 867,
            "rate": 86.7
          },
          {
            "type": "meso-drop",
            "count": 396,
            "rate": 39.6
          },
          {
            "type": "normal-damage",
            "count": 4,
            "rate": 0.4
          }
        ],
        "sub": [
          {
            "type": "meso-drop",
            "count": 630,
            "rate": 63
          },
          {
            "type": "item-drop",
            "count": 351,
            "rate": 35.1
          },
          {
            "type": "normal-damage",
            "count": 342,
            "rate": 34.2
          }
        ]
      }
    }
  },
  {
    "id": "윈드브레이커",
    "name": "윈드브레이커",
    "samples": 1000,
    "presets": {
      "boss": [
        "boss-damage",
        "abnormal-damage",
        "critical"
      ],
      "hunt": [
        "item-drop",
        "meso-drop",
        "normal-damage"
      ]
    },
    "rankings": {
      "boss": {
        "main": [
          {
            "type": "boss-damage",
            "count": 997,
            "rate": 99.7
          },
          {
            "type": "cooldown-skip",
            "count": 15,
            "rate": 1.5
          },
          {
            "type": "attack",
            "count": 7,
            "rate": 0.7
          },
          {
            "type": "buff-duration",
            "count": 7,
            "rate": 0.7
          },
          {
            "type": "max-hp",
            "count": 7,
            "rate": 0.7
          },
          {
            "type": "all-stat",
            "count": 6,
            "rate": 0.6
          },
          {
            "type": "int",
            "count": 6,
            "rate": 0.6
          },
          {
            "type": "str",
            "count": 6,
            "rate": 0.6
          }
        ],
        "sub": [
          {
            "type": "abnormal-damage",
            "count": 989,
            "rate": 98.9
          },
          {
            "type": "critical",
            "count": 975,
            "rate": 97.5
          },
          {
            "type": "attack",
            "count": 119,
            "rate": 11.9
          },
          {
            "type": "buff-duration",
            "count": 26,
            "rate": 2.6
          },
          {
            "type": "cooldown-skip",
            "count": 20,
            "rate": 2
          },
          {
            "type": "dex",
            "count": 16,
            "rate": 1.6
          },
          {
            "type": "all-stat",
            "count": 12,
            "rate": 1.2
          },
          {
            "type": "boss-damage",
            "count": 11,
            "rate": 1.1
          },
          {
            "type": "luk-dex",
            "count": 7,
            "rate": 0.7
          },
          {
            "type": "max-mp",
            "count": 7,
            "rate": 0.7
          },
          {
            "type": "ap-str-to-dex",
            "count": 6,
            "rate": 0.6
          },
          {
            "type": "dex-int",
            "count": 6,
            "rate": 0.6
          }
        ]
      },
      "hunt": {
        "main": [
          {
            "type": "item-drop",
            "count": 973,
            "rate": 97.3
          },
          {
            "type": "meso-drop",
            "count": 594,
            "rate": 59.4
          },
          {
            "type": "normal-damage",
            "count": 5,
            "rate": 0.5
          }
        ],
        "sub": [
          {
            "type": "meso-drop",
            "count": 805,
            "rate": 80.5
          },
          {
            "type": "normal-damage",
            "count": 724,
            "rate": 72.4
          },
          {
            "type": "item-drop",
            "count": 590,
            "rate": 59
          }
        ]
      }
    }
  },
  {
    "id": "은월",
    "name": "은월",
    "samples": 1000,
    "presets": {
      "boss": [
        "boss-damage",
        "abnormal-damage",
        "attack"
      ],
      "hunt": [
        "item-drop",
        "meso-drop",
        "normal-damage"
      ]
    },
    "rankings": {
      "boss": {
        "main": [
          {
            "type": "boss-damage",
            "count": 992,
            "rate": 99.2
          },
          {
            "type": "passive-level",
            "count": 55,
            "rate": 5.5
          },
          {
            "type": "cooldown-skip",
            "count": 17,
            "rate": 1.7
          },
          {
            "type": "attack",
            "count": 9,
            "rate": 0.9
          },
          {
            "type": "str",
            "count": 8,
            "rate": 0.8
          },
          {
            "type": "dex-luk",
            "count": 7,
            "rate": 0.7
          },
          {
            "type": "luk-int",
            "count": 6,
            "rate": 0.6
          },
          {
            "type": "max-mp",
            "count": 6,
            "rate": 0.6
          }
        ],
        "sub": [
          {
            "type": "abnormal-damage",
            "count": 977,
            "rate": 97.7
          },
          {
            "type": "attack",
            "count": 879,
            "rate": 87.9
          },
          {
            "type": "buff-duration",
            "count": 153,
            "rate": 15.3
          },
          {
            "type": "critical",
            "count": 121,
            "rate": 12.1
          },
          {
            "type": "cooldown-skip",
            "count": 102,
            "rate": 10.2
          },
          {
            "type": "boss-damage",
            "count": 79,
            "rate": 7.9
          },
          {
            "type": "str",
            "count": 15,
            "rate": 1.5
          },
          {
            "type": "all-stat",
            "count": 8,
            "rate": 0.8
          },
          {
            "type": "ap-int-to-luk",
            "count": 6,
            "rate": 0.6
          },
          {
            "type": "dex",
            "count": 6,
            "rate": 0.6
          },
          {
            "type": "dex-str",
            "count": 6,
            "rate": 0.6
          },
          {
            "type": "int-luk",
            "count": 6,
            "rate": 0.6
          }
        ]
      },
      "hunt": {
        "main": [
          {
            "type": "item-drop",
            "count": 939,
            "rate": 93.9
          },
          {
            "type": "meso-drop",
            "count": 473,
            "rate": 47.3
          },
          {
            "type": "normal-damage",
            "count": 3,
            "rate": 0.3
          }
        ],
        "sub": [
          {
            "type": "meso-drop",
            "count": 786,
            "rate": 78.6
          },
          {
            "type": "normal-damage",
            "count": 631,
            "rate": 63.1
          },
          {
            "type": "item-drop",
            "count": 474,
            "rate": 47.4
          }
        ]
      }
    }
  },
  {
    "id": "일리움",
    "name": "일리움",
    "samples": 1000,
    "presets": {
      "boss": [
        "boss-damage",
        "abnormal-damage",
        "magic"
      ],
      "hunt": [
        "item-drop",
        "meso-drop",
        "normal-damage"
      ]
    },
    "rankings": {
      "boss": {
        "main": [
          {
            "type": "boss-damage",
            "count": 983,
            "rate": 98.3
          },
          {
            "type": "cooldown-skip",
            "count": 354,
            "rate": 35.4
          },
          {
            "type": "multi-target",
            "count": 143,
            "rate": 14.3
          },
          {
            "type": "attack-speed",
            "count": 11,
            "rate": 1.1
          },
          {
            "type": "dex",
            "count": 6,
            "rate": 0.6
          },
          {
            "type": "int-str",
            "count": 6,
            "rate": 0.6
          },
          {
            "type": "luk",
            "count": 6,
            "rate": 0.6
          },
          {
            "type": "abnormal-damage",
            "count": 5,
            "rate": 0.5
          }
        ],
        "sub": [
          {
            "type": "abnormal-damage",
            "count": 986,
            "rate": 98.6
          },
          {
            "type": "magic",
            "count": 539,
            "rate": 53.9
          },
          {
            "type": "buff-duration",
            "count": 523,
            "rate": 52.3
          },
          {
            "type": "boss-damage",
            "count": 332,
            "rate": 33.2
          },
          {
            "type": "cooldown-skip",
            "count": 59,
            "rate": 5.9
          },
          {
            "type": "int",
            "count": 23,
            "rate": 2.3
          },
          {
            "type": "critical",
            "count": 19,
            "rate": 1.9
          },
          {
            "type": "all-stat",
            "count": 8,
            "rate": 0.8
          },
          {
            "type": "luk-int",
            "count": 7,
            "rate": 0.7
          },
          {
            "type": "max-hp",
            "count": 7,
            "rate": 0.7
          },
          {
            "type": "dex",
            "count": 6,
            "rate": 0.6
          },
          {
            "type": "str",
            "count": 5,
            "rate": 0.5
          }
        ]
      },
      "hunt": {
        "main": [
          {
            "type": "item-drop",
            "count": 826,
            "rate": 82.6
          },
          {
            "type": "meso-drop",
            "count": 374,
            "rate": 37.4
          }
        ],
        "sub": [
          {
            "type": "meso-drop",
            "count": 730,
            "rate": 73
          },
          {
            "type": "item-drop",
            "count": 503,
            "rate": 50.3
          },
          {
            "type": "normal-damage",
            "count": 497,
            "rate": 49.7
          }
        ]
      }
    }
  },
  {
    "id": "제논",
    "name": "제논",
    "samples": 1000,
    "presets": {
      "boss": [
        "boss-damage",
        "abnormal-damage",
        "buff-duration"
      ],
      "hunt": [
        "item-drop",
        "meso-drop",
        "normal-damage"
      ]
    },
    "rankings": {
      "boss": {
        "main": [
          {
            "type": "boss-damage",
            "count": 1000,
            "rate": 100
          },
          {
            "type": "buff-duration",
            "count": 9,
            "rate": 0.9
          },
          {
            "type": "str-luk",
            "count": 7,
            "rate": 0.7
          },
          {
            "type": "ap-luk-to-dex",
            "count": 5,
            "rate": 0.5
          },
          {
            "type": "attack",
            "count": 5,
            "rate": 0.5
          },
          {
            "type": "critical",
            "count": 5,
            "rate": 0.5
          },
          {
            "type": "int",
            "count": 5,
            "rate": 0.5
          },
          {
            "type": "int-str",
            "count": 5,
            "rate": 0.5
          }
        ],
        "sub": [
          {
            "type": "abnormal-damage",
            "count": 976,
            "rate": 97.6
          },
          {
            "type": "buff-duration",
            "count": 725,
            "rate": 72.5
          },
          {
            "type": "attack",
            "count": 685,
            "rate": 68.5
          },
          {
            "type": "critical",
            "count": 82,
            "rate": 8.2
          },
          {
            "type": "all-stat",
            "count": 17,
            "rate": 1.7
          },
          {
            "type": "cooldown-skip",
            "count": 14,
            "rate": 1.4
          },
          {
            "type": "boss-damage",
            "count": 10,
            "rate": 1
          },
          {
            "type": "max-mp",
            "count": 10,
            "rate": 1
          },
          {
            "type": "str-int",
            "count": 7,
            "rate": 0.7
          },
          {
            "type": "ap-luk-to-dex",
            "count": 6,
            "rate": 0.6
          },
          {
            "type": "dex-luk",
            "count": 6,
            "rate": 0.6
          },
          {
            "type": "str",
            "count": 6,
            "rate": 0.6
          }
        ]
      },
      "hunt": {
        "main": [
          {
            "type": "item-drop",
            "count": 920,
            "rate": 92
          },
          {
            "type": "meso-drop",
            "count": 382,
            "rate": 38.2
          },
          {
            "type": "normal-damage",
            "count": 7,
            "rate": 0.7
          }
        ],
        "sub": [
          {
            "type": "meso-drop",
            "count": 788,
            "rate": 78.8
          },
          {
            "type": "normal-damage",
            "count": 527,
            "rate": 52.7
          },
          {
            "type": "item-drop",
            "count": 379,
            "rate": 37.9
          }
        ]
      }
    }
  },
  {
    "id": "제로",
    "name": "제로",
    "samples": 1000,
    "presets": {
      "boss": [
        "boss-damage",
        "abnormal-damage",
        "attack"
      ],
      "hunt": [
        "item-drop",
        "meso-drop",
        "normal-damage"
      ]
    },
    "rankings": {
      "boss": {
        "main": [
          {
            "type": "boss-damage",
            "count": 980,
            "rate": 98
          },
          {
            "type": "cooldown-skip",
            "count": 559,
            "rate": 55.9
          },
          {
            "type": "attack",
            "count": 5,
            "rate": 0.5
          },
          {
            "type": "dex-str",
            "count": 5,
            "rate": 0.5
          },
          {
            "type": "dex",
            "count": 4,
            "rate": 0.4
          },
          {
            "type": "int",
            "count": 4,
            "rate": 0.4
          },
          {
            "type": "max-hp",
            "count": 4,
            "rate": 0.4
          },
          {
            "type": "str-dex",
            "count": 4,
            "rate": 0.4
          }
        ],
        "sub": [
          {
            "type": "abnormal-damage",
            "count": 990,
            "rate": 99
          },
          {
            "type": "attack",
            "count": 911,
            "rate": 91.1
          },
          {
            "type": "boss-damage",
            "count": 502,
            "rate": 50.2
          },
          {
            "type": "cooldown-skip",
            "count": 131,
            "rate": 13.1
          },
          {
            "type": "buff-duration",
            "count": 31,
            "rate": 3.1
          },
          {
            "type": "critical",
            "count": 23,
            "rate": 2.3
          },
          {
            "type": "all-stat",
            "count": 13,
            "rate": 1.3
          },
          {
            "type": "str",
            "count": 6,
            "rate": 0.6
          },
          {
            "type": "int-str",
            "count": 5,
            "rate": 0.5
          },
          {
            "type": "int-luk",
            "count": 4,
            "rate": 0.4
          },
          {
            "type": "str-dex",
            "count": 4,
            "rate": 0.4
          },
          {
            "type": "int",
            "count": 3,
            "rate": 0.3
          }
        ]
      },
      "hunt": {
        "main": [
          {
            "type": "item-drop",
            "count": 916,
            "rate": 91.6
          },
          {
            "type": "meso-drop",
            "count": 318,
            "rate": 31.8
          },
          {
            "type": "normal-damage",
            "count": 3,
            "rate": 0.3
          }
        ],
        "sub": [
          {
            "type": "meso-drop",
            "count": 830,
            "rate": 83
          },
          {
            "type": "normal-damage",
            "count": 674,
            "rate": 67.4
          },
          {
            "type": "item-drop",
            "count": 320,
            "rate": 32
          }
        ]
      }
    }
  },
  {
    "id": "카데나",
    "name": "카데나",
    "samples": 1000,
    "presets": {
      "boss": [
        "cooldown-skip",
        "abnormal-damage",
        "boss-damage"
      ],
      "hunt": [
        "item-drop",
        "meso-drop",
        "normal-damage"
      ]
    },
    "rankings": {
      "boss": {
        "main": [
          {
            "type": "cooldown-skip",
            "count": 998,
            "rate": 99.8
          },
          {
            "type": "boss-damage",
            "count": 37,
            "rate": 3.7
          },
          {
            "type": "luk-dex",
            "count": 12,
            "rate": 1.2
          },
          {
            "type": "luk-int",
            "count": 11,
            "rate": 1.1
          },
          {
            "type": "str",
            "count": 10,
            "rate": 1
          },
          {
            "type": "luk",
            "count": 9,
            "rate": 0.9
          },
          {
            "type": "int",
            "count": 8,
            "rate": 0.8
          },
          {
            "type": "str-dex",
            "count": 8,
            "rate": 0.8
          }
        ],
        "sub": [
          {
            "type": "abnormal-damage",
            "count": 981,
            "rate": 98.1
          },
          {
            "type": "boss-damage",
            "count": 960,
            "rate": 96
          },
          {
            "type": "attack",
            "count": 109,
            "rate": 10.9
          },
          {
            "type": "cooldown-skip",
            "count": 50,
            "rate": 5
          },
          {
            "type": "buff-duration",
            "count": 27,
            "rate": 2.7
          },
          {
            "type": "luk",
            "count": 14,
            "rate": 1.4
          },
          {
            "type": "all-stat",
            "count": 10,
            "rate": 1
          },
          {
            "type": "critical",
            "count": 9,
            "rate": 0.9
          },
          {
            "type": "str",
            "count": 8,
            "rate": 0.8
          },
          {
            "type": "ap-int-to-luk",
            "count": 6,
            "rate": 0.6
          },
          {
            "type": "dex-str",
            "count": 6,
            "rate": 0.6
          },
          {
            "type": "int",
            "count": 6,
            "rate": 0.6
          }
        ]
      },
      "hunt": {
        "main": [
          {
            "type": "item-drop",
            "count": 937,
            "rate": 93.7
          },
          {
            "type": "meso-drop",
            "count": 483,
            "rate": 48.3
          },
          {
            "type": "normal-damage",
            "count": 9,
            "rate": 0.9
          }
        ],
        "sub": [
          {
            "type": "meso-drop",
            "count": 749,
            "rate": 74.9
          },
          {
            "type": "normal-damage",
            "count": 561,
            "rate": 56.1
          },
          {
            "type": "item-drop",
            "count": 475,
            "rate": 47.5
          }
        ]
      }
    }
  },
  {
    "id": "카이저",
    "name": "카이저",
    "samples": 1000,
    "presets": {
      "boss": [
        "cooldown-skip",
        "buff-duration",
        "boss-damage"
      ],
      "hunt": [
        "item-drop",
        "meso-drop",
        "normal-damage"
      ]
    },
    "rankings": {
      "boss": {
        "main": [
          {
            "type": "cooldown-skip",
            "count": 952,
            "rate": 95.2
          },
          {
            "type": "boss-damage",
            "count": 474,
            "rate": 47.4
          },
          {
            "type": "buff-duration",
            "count": 36,
            "rate": 3.6
          },
          {
            "type": "multi-target",
            "count": 8,
            "rate": 0.8
          },
          {
            "type": "str-luk",
            "count": 8,
            "rate": 0.8
          },
          {
            "type": "luk-dex",
            "count": 7,
            "rate": 0.7
          },
          {
            "type": "str",
            "count": 7,
            "rate": 0.7
          },
          {
            "type": "str-int",
            "count": 7,
            "rate": 0.7
          }
        ],
        "sub": [
          {
            "type": "buff-duration",
            "count": 959,
            "rate": 95.9
          },
          {
            "type": "boss-damage",
            "count": 853,
            "rate": 85.3
          },
          {
            "type": "abnormal-damage",
            "count": 379,
            "rate": 37.9
          },
          {
            "type": "cooldown-skip",
            "count": 255,
            "rate": 25.5
          },
          {
            "type": "attack",
            "count": 85,
            "rate": 8.5
          },
          {
            "type": "critical",
            "count": 9,
            "rate": 0.9
          },
          {
            "type": "str",
            "count": 9,
            "rate": 0.9
          },
          {
            "type": "all-stat",
            "count": 8,
            "rate": 0.8
          },
          {
            "type": "luk",
            "count": 8,
            "rate": 0.8
          },
          {
            "type": "max-hp",
            "count": 8,
            "rate": 0.8
          },
          {
            "type": "str-dex",
            "count": 8,
            "rate": 0.8
          },
          {
            "type": "int-dex",
            "count": 7,
            "rate": 0.7
          }
        ]
      },
      "hunt": {
        "main": [
          {
            "type": "item-drop",
            "count": 887,
            "rate": 88.7
          },
          {
            "type": "meso-drop",
            "count": 315,
            "rate": 31.5
          },
          {
            "type": "normal-damage",
            "count": 6,
            "rate": 0.6
          }
        ],
        "sub": [
          {
            "type": "meso-drop",
            "count": 760,
            "rate": 76
          },
          {
            "type": "normal-damage",
            "count": 456,
            "rate": 45.6
          },
          {
            "type": "item-drop",
            "count": 313,
            "rate": 31.3
          }
        ]
      }
    }
  },
  {
    "id": "카인",
    "name": "카인",
    "samples": 1000,
    "presets": {
      "boss": [
        "boss-damage",
        "critical",
        "abnormal-damage"
      ],
      "hunt": [
        "item-drop",
        "meso-drop",
        "normal-damage"
      ]
    },
    "rankings": {
      "boss": {
        "main": [
          {
            "type": "boss-damage",
            "count": 834,
            "rate": 83.4
          },
          {
            "type": "passive-level",
            "count": 485,
            "rate": 48.5
          },
          {
            "type": "cooldown-skip",
            "count": 37,
            "rate": 3.7
          },
          {
            "type": "int",
            "count": 13,
            "rate": 1.3
          },
          {
            "type": "dex",
            "count": 12,
            "rate": 1.2
          },
          {
            "type": "luk-int",
            "count": 11,
            "rate": 1.1
          },
          {
            "type": "max-mp",
            "count": 10,
            "rate": 1
          },
          {
            "type": "int-str",
            "count": 9,
            "rate": 0.9
          }
        ],
        "sub": [
          {
            "type": "critical",
            "count": 933,
            "rate": 93.3
          },
          {
            "type": "abnormal-damage",
            "count": 884,
            "rate": 88.4
          },
          {
            "type": "boss-damage",
            "count": 457,
            "rate": 45.7
          },
          {
            "type": "attack",
            "count": 80,
            "rate": 8
          },
          {
            "type": "cooldown-skip",
            "count": 57,
            "rate": 5.7
          },
          {
            "type": "all-stat",
            "count": 14,
            "rate": 1.4
          },
          {
            "type": "dex",
            "count": 13,
            "rate": 1.3
          },
          {
            "type": "buff-duration",
            "count": 10,
            "rate": 1
          },
          {
            "type": "dex-int",
            "count": 10,
            "rate": 1
          },
          {
            "type": "dex-str",
            "count": 9,
            "rate": 0.9
          },
          {
            "type": "int-str",
            "count": 8,
            "rate": 0.8
          },
          {
            "type": "luk-dex",
            "count": 8,
            "rate": 0.8
          }
        ]
      },
      "hunt": {
        "main": [
          {
            "type": "item-drop",
            "count": 919,
            "rate": 91.9
          },
          {
            "type": "meso-drop",
            "count": 317,
            "rate": 31.7
          },
          {
            "type": "normal-damage",
            "count": 6,
            "rate": 0.6
          }
        ],
        "sub": [
          {
            "type": "meso-drop",
            "count": 788,
            "rate": 78.8
          },
          {
            "type": "normal-damage",
            "count": 537,
            "rate": 53.7
          },
          {
            "type": "item-drop",
            "count": 313,
            "rate": 31.3
          }
        ]
      }
    }
  },
  {
    "id": "칼리",
    "name": "칼리",
    "samples": 1000,
    "presets": {
      "boss": [
        "cooldown-skip",
        "abnormal-damage",
        "boss-damage"
      ],
      "hunt": [
        "item-drop",
        "meso-drop",
        "normal-damage"
      ]
    },
    "rankings": {
      "boss": {
        "main": [
          {
            "type": "cooldown-skip",
            "count": 995,
            "rate": 99.5
          },
          {
            "type": "boss-damage",
            "count": 38,
            "rate": 3.8
          },
          {
            "type": "int",
            "count": 13,
            "rate": 1.3
          },
          {
            "type": "max-hp",
            "count": 11,
            "rate": 1.1
          },
          {
            "type": "dex-luk",
            "count": 10,
            "rate": 1
          },
          {
            "type": "ap-luk-to-dex",
            "count": 8,
            "rate": 0.8
          },
          {
            "type": "luk",
            "count": 8,
            "rate": 0.8
          },
          {
            "type": "luk-dex",
            "count": 8,
            "rate": 0.8
          }
        ],
        "sub": [
          {
            "type": "abnormal-damage",
            "count": 975,
            "rate": 97.5
          },
          {
            "type": "boss-damage",
            "count": 952,
            "rate": 95.2
          },
          {
            "type": "attack",
            "count": 102,
            "rate": 10.2
          },
          {
            "type": "cooldown-skip",
            "count": 53,
            "rate": 5.3
          },
          {
            "type": "critical",
            "count": 42,
            "rate": 4.2
          },
          {
            "type": "buff-duration",
            "count": 23,
            "rate": 2.3
          },
          {
            "type": "int-luk",
            "count": 15,
            "rate": 1.5
          },
          {
            "type": "luk",
            "count": 15,
            "rate": 1.5
          },
          {
            "type": "all-stat",
            "count": 11,
            "rate": 1.1
          },
          {
            "type": "ap-dex-to-str",
            "count": 10,
            "rate": 1
          },
          {
            "type": "max-hp",
            "count": 10,
            "rate": 1
          },
          {
            "type": "dex-int",
            "count": 9,
            "rate": 0.9
          }
        ]
      },
      "hunt": {
        "main": [
          {
            "type": "item-drop",
            "count": 938,
            "rate": 93.8
          },
          {
            "type": "meso-drop",
            "count": 493,
            "rate": 49.3
          },
          {
            "type": "normal-damage",
            "count": 5,
            "rate": 0.5
          }
        ],
        "sub": [
          {
            "type": "meso-drop",
            "count": 730,
            "rate": 73
          },
          {
            "type": "normal-damage",
            "count": 525,
            "rate": 52.5
          },
          {
            "type": "item-drop",
            "count": 461,
            "rate": 46.1
          }
        ]
      }
    }
  },
  {
    "id": "캐논마스터",
    "name": "캐논마스터",
    "samples": 1000,
    "presets": {
      "boss": [
        "boss-damage",
        "abnormal-damage",
        "attack"
      ],
      "hunt": [
        "item-drop",
        "meso-drop",
        "normal-damage"
      ]
    },
    "rankings": {
      "boss": {
        "main": [
          {
            "type": "boss-damage",
            "count": 1000,
            "rate": 100
          },
          {
            "type": "cooldown-skip",
            "count": 24,
            "rate": 2.4
          },
          {
            "type": "buff-duration",
            "count": 16,
            "rate": 1.6
          },
          {
            "type": "dex",
            "count": 8,
            "rate": 0.8
          },
          {
            "type": "dex-str",
            "count": 8,
            "rate": 0.8
          },
          {
            "type": "max-hp",
            "count": 8,
            "rate": 0.8
          },
          {
            "type": "attack",
            "count": 6,
            "rate": 0.6
          },
          {
            "type": "int",
            "count": 6,
            "rate": 0.6
          }
        ],
        "sub": [
          {
            "type": "abnormal-damage",
            "count": 988,
            "rate": 98.8
          },
          {
            "type": "attack",
            "count": 827,
            "rate": 82.7
          },
          {
            "type": "buff-duration",
            "count": 260,
            "rate": 26
          },
          {
            "type": "critical",
            "count": 186,
            "rate": 18.6
          },
          {
            "type": "cooldown-skip",
            "count": 21,
            "rate": 2.1
          },
          {
            "type": "all-stat",
            "count": 10,
            "rate": 1
          },
          {
            "type": "boss-damage",
            "count": 9,
            "rate": 0.9
          },
          {
            "type": "str",
            "count": 9,
            "rate": 0.9
          },
          {
            "type": "str-dex",
            "count": 6,
            "rate": 0.6
          },
          {
            "type": "dex-luk",
            "count": 5,
            "rate": 0.5
          },
          {
            "type": "int-dex",
            "count": 5,
            "rate": 0.5
          },
          {
            "type": "luk-str",
            "count": 5,
            "rate": 0.5
          }
        ]
      },
      "hunt": {
        "main": [
          {
            "type": "item-drop",
            "count": 944,
            "rate": 94.4
          },
          {
            "type": "meso-drop",
            "count": 406,
            "rate": 40.6
          },
          {
            "type": "normal-damage",
            "count": 7,
            "rate": 0.7
          }
        ],
        "sub": [
          {
            "type": "meso-drop",
            "count": 821,
            "rate": 82.1
          },
          {
            "type": "normal-damage",
            "count": 580,
            "rate": 58
          },
          {
            "type": "item-drop",
            "count": 398,
            "rate": 39.8
          }
        ]
      }
    }
  },
  {
    "id": "캡틴",
    "name": "캡틴",
    "samples": 1000,
    "presets": {
      "boss": [
        "cooldown-skip",
        "abnormal-damage",
        "boss-damage"
      ],
      "hunt": [
        "item-drop",
        "meso-drop",
        "normal-damage"
      ]
    },
    "rankings": {
      "boss": {
        "main": [
          {
            "type": "cooldown-skip",
            "count": 978,
            "rate": 97.8
          },
          {
            "type": "boss-damage",
            "count": 258,
            "rate": 25.8
          },
          {
            "type": "dex",
            "count": 10,
            "rate": 1
          },
          {
            "type": "int",
            "count": 9,
            "rate": 0.9
          },
          {
            "type": "str-luk",
            "count": 8,
            "rate": 0.8
          },
          {
            "type": "attack",
            "count": 7,
            "rate": 0.7
          },
          {
            "type": "str",
            "count": 7,
            "rate": 0.7
          },
          {
            "type": "ap-luk-to-dex",
            "count": 6,
            "rate": 0.6
          }
        ],
        "sub": [
          {
            "type": "abnormal-damage",
            "count": 978,
            "rate": 97.8
          },
          {
            "type": "boss-damage",
            "count": 953,
            "rate": 95.3
          },
          {
            "type": "cooldown-skip",
            "count": 264,
            "rate": 26.4
          },
          {
            "type": "attack",
            "count": 100,
            "rate": 10
          },
          {
            "type": "buff-duration",
            "count": 35,
            "rate": 3.5
          },
          {
            "type": "dex-int",
            "count": 14,
            "rate": 1.4
          },
          {
            "type": "all-stat",
            "count": 12,
            "rate": 1.2
          },
          {
            "type": "dex",
            "count": 11,
            "rate": 1.1
          },
          {
            "type": "dex-luk",
            "count": 11,
            "rate": 1.1
          },
          {
            "type": "dex-str",
            "count": 9,
            "rate": 0.9
          },
          {
            "type": "ap-dex-to-str",
            "count": 8,
            "rate": 0.8
          },
          {
            "type": "str-dex",
            "count": 7,
            "rate": 0.7
          }
        ]
      },
      "hunt": {
        "main": [
          {
            "type": "item-drop",
            "count": 911,
            "rate": 91.1
          },
          {
            "type": "meso-drop",
            "count": 472,
            "rate": 47.2
          },
          {
            "type": "normal-damage",
            "count": 4,
            "rate": 0.4
          }
        ],
        "sub": [
          {
            "type": "meso-drop",
            "count": 716,
            "rate": 71.6
          },
          {
            "type": "normal-damage",
            "count": 557,
            "rate": 55.7
          },
          {
            "type": "item-drop",
            "count": 461,
            "rate": 46.1
          }
        ]
      }
    }
  },
  {
    "id": "키네시스",
    "name": "키네시스",
    "samples": 1000,
    "presets": {
      "boss": [
        "boss-damage",
        "abnormal-damage",
        "buff-duration"
      ],
      "hunt": [
        "item-drop",
        "meso-drop",
        "normal-damage"
      ]
    },
    "rankings": {
      "boss": {
        "main": [
          {
            "type": "boss-damage",
            "count": 967,
            "rate": 96.7
          },
          {
            "type": "passive-level",
            "count": 65,
            "rate": 6.5
          },
          {
            "type": "multi-target",
            "count": 61,
            "rate": 6.1
          },
          {
            "type": "max-mp",
            "count": 10,
            "rate": 1
          },
          {
            "type": "luk",
            "count": 9,
            "rate": 0.9
          },
          {
            "type": "magic",
            "count": 8,
            "rate": 0.8
          },
          {
            "type": "str-int",
            "count": 8,
            "rate": 0.8
          },
          {
            "type": "dex-luk",
            "count": 7,
            "rate": 0.7
          }
        ],
        "sub": [
          {
            "type": "abnormal-damage",
            "count": 954,
            "rate": 95.4
          },
          {
            "type": "buff-duration",
            "count": 669,
            "rate": 66.9
          },
          {
            "type": "magic",
            "count": 340,
            "rate": 34
          },
          {
            "type": "boss-damage",
            "count": 58,
            "rate": 5.8
          },
          {
            "type": "critical",
            "count": 41,
            "rate": 4.1
          },
          {
            "type": "cooldown-skip",
            "count": 29,
            "rate": 2.9
          },
          {
            "type": "int",
            "count": 22,
            "rate": 2.2
          },
          {
            "type": "all-stat",
            "count": 17,
            "rate": 1.7
          },
          {
            "type": "int-dex",
            "count": 11,
            "rate": 1.1
          },
          {
            "type": "int-str",
            "count": 9,
            "rate": 0.9
          },
          {
            "type": "str-int",
            "count": 9,
            "rate": 0.9
          },
          {
            "type": "dex-luk",
            "count": 8,
            "rate": 0.8
          }
        ]
      },
      "hunt": {
        "main": [
          {
            "type": "item-drop",
            "count": 901,
            "rate": 90.1
          },
          {
            "type": "meso-drop",
            "count": 480,
            "rate": 48
          },
          {
            "type": "normal-damage",
            "count": 5,
            "rate": 0.5
          }
        ],
        "sub": [
          {
            "type": "meso-drop",
            "count": 705,
            "rate": 70.5
          },
          {
            "type": "item-drop",
            "count": 503,
            "rate": 50.3
          },
          {
            "type": "normal-damage",
            "count": 480,
            "rate": 48
          }
        ]
      }
    }
  },
  {
    "id": "팔라딘",
    "name": "팔라딘",
    "samples": 1000,
    "presets": {
      "boss": [
        "boss-damage",
        "abnormal-damage",
        "attack"
      ],
      "hunt": [
        "item-drop",
        "meso-drop",
        "normal-damage"
      ]
    },
    "rankings": {
      "boss": {
        "main": [
          {
            "type": "boss-damage",
            "count": 994,
            "rate": 99.4
          },
          {
            "type": "cooldown-skip",
            "count": 103,
            "rate": 10.3
          },
          {
            "type": "buff-duration",
            "count": 9,
            "rate": 0.9
          },
          {
            "type": "str-dex",
            "count": 9,
            "rate": 0.9
          },
          {
            "type": "int-dex",
            "count": 7,
            "rate": 0.7
          },
          {
            "type": "int-luk",
            "count": 7,
            "rate": 0.7
          },
          {
            "type": "str",
            "count": 6,
            "rate": 0.6
          },
          {
            "type": "max-hp",
            "count": 5,
            "rate": 0.5
          }
        ],
        "sub": [
          {
            "type": "abnormal-damage",
            "count": 988,
            "rate": 98.8
          },
          {
            "type": "attack",
            "count": 840,
            "rate": 84
          },
          {
            "type": "cooldown-skip",
            "count": 225,
            "rate": 22.5
          },
          {
            "type": "buff-duration",
            "count": 169,
            "rate": 16.9
          },
          {
            "type": "boss-damage",
            "count": 90,
            "rate": 9
          },
          {
            "type": "critical",
            "count": 79,
            "rate": 7.9
          },
          {
            "type": "str",
            "count": 12,
            "rate": 1.2
          },
          {
            "type": "all-stat",
            "count": 8,
            "rate": 0.8
          },
          {
            "type": "dex",
            "count": 8,
            "rate": 0.8
          },
          {
            "type": "str-dex",
            "count": 6,
            "rate": 0.6
          },
          {
            "type": "dex-str",
            "count": 5,
            "rate": 0.5
          },
          {
            "type": "luk",
            "count": 5,
            "rate": 0.5
          }
        ]
      },
      "hunt": {
        "main": [
          {
            "type": "item-drop",
            "count": 940,
            "rate": 94
          },
          {
            "type": "meso-drop",
            "count": 410,
            "rate": 41
          },
          {
            "type": "normal-damage",
            "count": 2,
            "rate": 0.2
          }
        ],
        "sub": [
          {
            "type": "meso-drop",
            "count": 818,
            "rate": 81.8
          },
          {
            "type": "normal-damage",
            "count": 627,
            "rate": 62.7
          },
          {
            "type": "item-drop",
            "count": 410,
            "rate": 41
          }
        ]
      }
    }
  },
  {
    "id": "패스파인더",
    "name": "패스파인더",
    "samples": 1000,
    "presets": {
      "boss": [
        "cooldown-skip",
        "critical",
        "boss-damage"
      ],
      "hunt": [
        "item-drop",
        "meso-drop",
        "normal-damage"
      ]
    },
    "rankings": {
      "boss": {
        "main": [
          {
            "type": "cooldown-skip",
            "count": 913,
            "rate": 91.3
          },
          {
            "type": "boss-damage",
            "count": 540,
            "rate": 54
          },
          {
            "type": "str-luk",
            "count": 10,
            "rate": 1
          },
          {
            "type": "dex-str",
            "count": 6,
            "rate": 0.6
          },
          {
            "type": "str",
            "count": 6,
            "rate": 0.6
          },
          {
            "type": "str-dex",
            "count": 6,
            "rate": 0.6
          },
          {
            "type": "dex",
            "count": 5,
            "rate": 0.5
          },
          {
            "type": "int-dex",
            "count": 5,
            "rate": 0.5
          }
        ],
        "sub": [
          {
            "type": "critical",
            "count": 960,
            "rate": 96
          },
          {
            "type": "boss-damage",
            "count": 855,
            "rate": 85.5
          },
          {
            "type": "abnormal-damage",
            "count": 565,
            "rate": 56.5
          },
          {
            "type": "cooldown-skip",
            "count": 94,
            "rate": 9.4
          },
          {
            "type": "attack",
            "count": 92,
            "rate": 9.2
          },
          {
            "type": "buff-duration",
            "count": 9,
            "rate": 0.9
          },
          {
            "type": "all-stat",
            "count": 8,
            "rate": 0.8
          },
          {
            "type": "dex",
            "count": 7,
            "rate": 0.7
          },
          {
            "type": "int-dex",
            "count": 7,
            "rate": 0.7
          },
          {
            "type": "dex-int",
            "count": 5,
            "rate": 0.5
          },
          {
            "type": "dex-str",
            "count": 5,
            "rate": 0.5
          },
          {
            "type": "int-luk",
            "count": 5,
            "rate": 0.5
          }
        ]
      },
      "hunt": {
        "main": [
          {
            "type": "item-drop",
            "count": 917,
            "rate": 91.7
          },
          {
            "type": "meso-drop",
            "count": 347,
            "rate": 34.7
          },
          {
            "type": "normal-damage",
            "count": 8,
            "rate": 0.8
          }
        ],
        "sub": [
          {
            "type": "meso-drop",
            "count": 818,
            "rate": 81.8
          },
          {
            "type": "normal-damage",
            "count": 709,
            "rate": 70.9
          },
          {
            "type": "item-drop",
            "count": 347,
            "rate": 34.7
          }
        ]
      }
    }
  },
  {
    "id": "팬텀",
    "name": "팬텀",
    "samples": 1000,
    "presets": {
      "boss": [
        "boss-damage",
        "abnormal-damage",
        "cooldown-skip"
      ],
      "hunt": [
        "item-drop",
        "meso-drop",
        "normal-damage"
      ]
    },
    "rankings": {
      "boss": {
        "main": [
          {
            "type": "boss-damage",
            "count": 977,
            "rate": 97.7
          },
          {
            "type": "cooldown-skip",
            "count": 450,
            "rate": 45
          },
          {
            "type": "buff-duration",
            "count": 17,
            "rate": 1.7
          },
          {
            "type": "int-str",
            "count": 9,
            "rate": 0.9
          },
          {
            "type": "int",
            "count": 8,
            "rate": 0.8
          },
          {
            "type": "max-hp",
            "count": 7,
            "rate": 0.7
          },
          {
            "type": "max-mp",
            "count": 6,
            "rate": 0.6
          },
          {
            "type": "dex-str",
            "count": 5,
            "rate": 0.5
          }
        ],
        "sub": [
          {
            "type": "abnormal-damage",
            "count": 986,
            "rate": 98.6
          },
          {
            "type": "cooldown-skip",
            "count": 953,
            "rate": 95.3
          },
          {
            "type": "boss-damage",
            "count": 435,
            "rate": 43.5
          },
          {
            "type": "buff-duration",
            "count": 274,
            "rate": 27.4
          },
          {
            "type": "attack",
            "count": 80,
            "rate": 8
          },
          {
            "type": "critical",
            "count": 19,
            "rate": 1.9
          },
          {
            "type": "int-luk",
            "count": 9,
            "rate": 0.9
          },
          {
            "type": "str-luk",
            "count": 6,
            "rate": 0.6
          },
          {
            "type": "int-dex",
            "count": 5,
            "rate": 0.5
          },
          {
            "type": "luk",
            "count": 5,
            "rate": 0.5
          },
          {
            "type": "all-stat",
            "count": 4,
            "rate": 0.4
          },
          {
            "type": "luk-dex",
            "count": 4,
            "rate": 0.4
          }
        ]
      },
      "hunt": {
        "main": [
          {
            "type": "item-drop",
            "count": 937,
            "rate": 93.7
          },
          {
            "type": "meso-drop",
            "count": 338,
            "rate": 33.8
          },
          {
            "type": "normal-damage",
            "count": 1,
            "rate": 0.1
          }
        ],
        "sub": [
          {
            "type": "meso-drop",
            "count": 854,
            "rate": 85.4
          },
          {
            "type": "normal-damage",
            "count": 508,
            "rate": 50.8
          },
          {
            "type": "item-drop",
            "count": 332,
            "rate": 33.2
          }
        ]
      }
    }
  },
  {
    "id": "플레임위자드",
    "name": "플레임위자드",
    "samples": 1000,
    "presets": {
      "boss": [
        "passive-level",
        "abnormal-damage",
        "boss-damage"
      ],
      "hunt": [
        "item-drop",
        "meso-drop",
        "normal-damage"
      ]
    },
    "rankings": {
      "boss": {
        "main": [
          {
            "type": "passive-level",
            "count": 965,
            "rate": 96.5
          },
          {
            "type": "boss-damage",
            "count": 185,
            "rate": 18.5
          },
          {
            "type": "buff-duration",
            "count": 12,
            "rate": 1.2
          },
          {
            "type": "dex-int",
            "count": 10,
            "rate": 1
          },
          {
            "type": "max-mp",
            "count": 10,
            "rate": 1
          },
          {
            "type": "str",
            "count": 9,
            "rate": 0.9
          },
          {
            "type": "int-dex",
            "count": 8,
            "rate": 0.8
          },
          {
            "type": "str-dex",
            "count": 7,
            "rate": 0.7
          }
        ],
        "sub": [
          {
            "type": "abnormal-damage",
            "count": 940,
            "rate": 94
          },
          {
            "type": "boss-damage",
            "count": 895,
            "rate": 89.5
          },
          {
            "type": "buff-duration",
            "count": 277,
            "rate": 27.7
          },
          {
            "type": "critical",
            "count": 113,
            "rate": 11.3
          },
          {
            "type": "magic",
            "count": 85,
            "rate": 8.5
          },
          {
            "type": "cooldown-skip",
            "count": 27,
            "rate": 2.7
          },
          {
            "type": "int",
            "count": 20,
            "rate": 2
          },
          {
            "type": "all-stat",
            "count": 11,
            "rate": 1.1
          },
          {
            "type": "dex",
            "count": 8,
            "rate": 0.8
          },
          {
            "type": "luk-dex",
            "count": 8,
            "rate": 0.8
          },
          {
            "type": "max-mp",
            "count": 8,
            "rate": 0.8
          },
          {
            "type": "ap-dex-to-str",
            "count": 7,
            "rate": 0.7
          }
        ]
      },
      "hunt": {
        "main": [
          {
            "type": "item-drop",
            "count": 887,
            "rate": 88.7
          },
          {
            "type": "meso-drop",
            "count": 447,
            "rate": 44.7
          },
          {
            "type": "normal-damage",
            "count": 4,
            "rate": 0.4
          }
        ],
        "sub": [
          {
            "type": "meso-drop",
            "count": 683,
            "rate": 68.3
          },
          {
            "type": "normal-damage",
            "count": 445,
            "rate": 44.5
          },
          {
            "type": "item-drop",
            "count": 430,
            "rate": 43
          }
        ]
      }
    }
  },
  {
    "id": "호영",
    "name": "호영",
    "samples": 1000,
    "presets": {
      "boss": [
        "passive-level",
        "abnormal-damage",
        "boss-damage"
      ],
      "hunt": [
        "item-drop",
        "meso-drop",
        "normal-damage"
      ]
    },
    "rankings": {
      "boss": {
        "main": [
          {
            "type": "passive-level",
            "count": 973,
            "rate": 97.3
          },
          {
            "type": "boss-damage",
            "count": 149,
            "rate": 14.9
          },
          {
            "type": "cooldown-skip",
            "count": 12,
            "rate": 1.2
          },
          {
            "type": "str-dex",
            "count": 10,
            "rate": 1
          },
          {
            "type": "max-hp",
            "count": 7,
            "rate": 0.7
          },
          {
            "type": "dex",
            "count": 5,
            "rate": 0.5
          },
          {
            "type": "int-luk",
            "count": 5,
            "rate": 0.5
          },
          {
            "type": "str-int",
            "count": 5,
            "rate": 0.5
          }
        ],
        "sub": [
          {
            "type": "abnormal-damage",
            "count": 991,
            "rate": 99.1
          },
          {
            "type": "boss-damage",
            "count": 955,
            "rate": 95.5
          },
          {
            "type": "buff-duration",
            "count": 153,
            "rate": 15.3
          },
          {
            "type": "attack",
            "count": 132,
            "rate": 13.2
          },
          {
            "type": "critical",
            "count": 27,
            "rate": 2.7
          },
          {
            "type": "cooldown-skip",
            "count": 21,
            "rate": 2.1
          },
          {
            "type": "luk",
            "count": 15,
            "rate": 1.5
          },
          {
            "type": "all-stat",
            "count": 9,
            "rate": 0.9
          },
          {
            "type": "luk-dex",
            "count": 7,
            "rate": 0.7
          },
          {
            "type": "luk-int",
            "count": 5,
            "rate": 0.5
          },
          {
            "type": "str",
            "count": 5,
            "rate": 0.5
          },
          {
            "type": "dex-luk",
            "count": 4,
            "rate": 0.4
          }
        ]
      },
      "hunt": {
        "main": [
          {
            "type": "item-drop",
            "count": 965,
            "rate": 96.5
          },
          {
            "type": "meso-drop",
            "count": 543,
            "rate": 54.3
          },
          {
            "type": "normal-damage",
            "count": 6,
            "rate": 0.6
          }
        ],
        "sub": [
          {
            "type": "meso-drop",
            "count": 823,
            "rate": 82.3
          },
          {
            "type": "normal-damage",
            "count": 649,
            "rate": 64.9
          },
          {
            "type": "item-drop",
            "count": 531,
            "rate": 53.1
          }
        ]
      }
    }
  },
  {
    "id": "히어로",
    "name": "히어로",
    "samples": 1000,
    "presets": {
      "boss": [
        "boss-damage",
        "abnormal-damage",
        "attack"
      ],
      "hunt": [
        "item-drop",
        "meso-drop",
        "normal-damage"
      ]
    },
    "rankings": {
      "boss": {
        "main": [
          {
            "type": "boss-damage",
            "count": 999,
            "rate": 99.9
          },
          {
            "type": "buff-duration",
            "count": 7,
            "rate": 0.7
          },
          {
            "type": "dex-int",
            "count": 7,
            "rate": 0.7
          },
          {
            "type": "cooldown-skip",
            "count": 6,
            "rate": 0.6
          },
          {
            "type": "dex-str",
            "count": 6,
            "rate": 0.6
          },
          {
            "type": "all-stat",
            "count": 5,
            "rate": 0.5
          },
          {
            "type": "attack",
            "count": 5,
            "rate": 0.5
          },
          {
            "type": "int-str",
            "count": 5,
            "rate": 0.5
          }
        ],
        "sub": [
          {
            "type": "abnormal-damage",
            "count": 991,
            "rate": 99.1
          },
          {
            "type": "attack",
            "count": 824,
            "rate": 82.4
          },
          {
            "type": "buff-duration",
            "count": 386,
            "rate": 38.6
          },
          {
            "type": "critical",
            "count": 215,
            "rate": 21.5
          },
          {
            "type": "str",
            "count": 12,
            "rate": 1.2
          },
          {
            "type": "cooldown-skip",
            "count": 11,
            "rate": 1.1
          },
          {
            "type": "all-stat",
            "count": 8,
            "rate": 0.8
          },
          {
            "type": "boss-damage",
            "count": 8,
            "rate": 0.8
          },
          {
            "type": "str-luk",
            "count": 8,
            "rate": 0.8
          },
          {
            "type": "ap-dex-to-str",
            "count": 5,
            "rate": 0.5
          },
          {
            "type": "dex",
            "count": 5,
            "rate": 0.5
          },
          {
            "type": "luk-str",
            "count": 4,
            "rate": 0.4
          }
        ]
      },
      "hunt": {
        "main": [
          {
            "type": "item-drop",
            "count": 944,
            "rate": 94.4
          },
          {
            "type": "meso-drop",
            "count": 375,
            "rate": 37.5
          },
          {
            "type": "normal-damage",
            "count": 9,
            "rate": 0.9
          }
        ],
        "sub": [
          {
            "type": "meso-drop",
            "count": 846,
            "rate": 84.6
          },
          {
            "type": "normal-damage",
            "count": 676,
            "rate": 67.6
          },
          {
            "type": "item-drop",
            "count": 370,
            "rate": 37
          }
        ]
      }
    }
  }
]);
