export function getRandomPlaces() {
  const sample = [
    {
      name: 'Eiffel Tower',
      description: 'Paris, France',
      lat: 48.8584,
      lon: 2.2945,
      tags: ['landmark', 'historic', 'architecture'],
      Rating: '',
      Date: '',
      visited: false
    },
    {
      name: 'Statue of Liberty',
      description: 'New York, USA',
      lat: 40.6892,
      lon: -74.0445,
      tags: ['landmark', 'monument', 'historic'],
      Rating: '',
      Date: '',
      visited: false
    },
    {
      name: 'Great Pyramid of Giza',
      description: 'Giza, Egypt',
      lat: 29.9792,
      lon: 31.1342,
      tags: ['landmark', 'ancient', 'world wonder'],
      Rating: '',
      Date: '',
      visited: false
    },
    {
      name: 'Sydney Opera House',
      description: 'Sydney, Australia',
      lat: -33.8568,
      lon: 151.2153,
      tags: ['landmark', 'performing arts', 'architecture'],
      Rating: '',
      Date: '',
      visited: false
    },
    {
      name: 'Taj Mahal',
      description: 'Agra, India',
      lat: 27.1751,
      lon: 78.0421,
      tags: ['landmark', 'heritage', 'mausoleum'],
      Rating: '',
      Date: '',
      visited: false
    },
    {
      name: 'Mount Fuji',
      description: 'Honshu, Japan',
      lat: 35.3606,
      lon: 138.7274,
      tags: ['landmark', 'natural', 'mountain'],
      Rating: '',
      Date: '',
      visited: false
    },
    {
      name: 'Golden Gate Bridge',
      description: 'San Francisco, USA',
      lat: 37.8199,
      lon: -122.4783,
      tags: ['landmark'],
      Rating: '',
      Date: '',
      visited: false
    },
    {
      name: 'Christ the Redeemer',
      description: 'Rio de Janeiro, Brazil',
      lat: -22.9519,
      lon: -43.2105,
      tags: ['landmark'],
      Rating: '',
      Date: '',
      visited: false
    },
    {
      name: 'Colosseum',
      description: 'Rome, Italy',
      lat: 41.8902,
      lon: 12.4922,
      tags: ['landmark'],
      Rating: '',
      Date: '',
      visited: false
    },
    {
      name: 'Machu Picchu',
      description: 'Cusco Region, Peru',
      lat: -13.1631,
      lon: -72.545,
      tags: ['landmark'],
      Rating: '',
      Date: '',
      visited: false
    },
    {
      name: 'Andorra la Vella',
      description: 'Andorra',
      lat: 42.50779,
      lon: 1.52109,
      tags: ['landmark'],
      Rating: '',
      Date: '',
      visited: false
    },
    {
      name: 'Louvre Museum',
      description: 'Paris, France',
      lat: 48.8606,
      lon: 2.3376,
      tags: ['museum', 'art', 'landmark'],
      Rating: '',
      Date: '',
      visited: false
    },
    {
      name: 'Grand Canyon',
      description: 'Arizona, USA',
      lat: 36.1069,
      lon: -112.1129,
      tags: ['nature', 'park', 'landmark'],
      Rating: '',
      Date: '',
      visited: false
    },
    {
      name: 'Niagara Falls',
      description: 'Ontario, Canada',
      lat: 43.0962,
      lon: -79.0377,
      tags: ['nature', 'waterfall', 'landmark'],
      Rating: '',
      Date: '',
      visited: false
    },
    {
      name: 'Great Barrier Reef',
      description: 'Queensland, Australia',
      lat: -18.2871,
      lon: 147.6992,
      tags: ['nature', 'reef', 'marine'],
      Rating: '',
      Date: '',
      visited: false
    },
    {
      name: 'Serengeti National Park',
      description: 'Tanzania',
      lat: -2.3333,
      lon: 34.8333,
      tags: ['nature', 'wildlife', 'park'],
      Rating: '',
      Date: '',
      visited: false
    },
    {
      name: 'Great Wall of China',
      description: 'Beijing, China',
      lat: 40.4319,
      lon: 116.5704,
      tags: ['landmark', 'historic'],
      Rating: '',
      Date: '',
      visited: false
    },
    {
      name: 'Sagrada Família',
      description: 'Barcelona, Spain',
      lat: 41.4036,
      lon: 2.1744,
      tags: ['landmark', 'architecture'],
      Rating: '',
      Date: '',
      visited: false
    },
    {
      name: 'Chichen Itza',
      description: 'Yucatán, Mexico',
      lat: 20.6843,
      lon: -88.5678,
      tags: ['landmark', 'historic'],
      Rating: '',
      Date: '',
      visited: false
    },
    {
      name: 'Banff National Park',
      description: 'Alberta, Canada',
      lat: 51.4968,
      lon: -115.9281,
      tags: ['nature', 'park'],
      Rating: '',
      Date: '',
      visited: false
    },
    {
      name: 'Uluru',
      description: 'Northern Territory, Australia',
      lat: -25.3444,
      lon: 131.0369,
      tags: ['landmark', 'nature'],
      Rating: '',
      Date: '',
      visited: false
    },
    {
      name: 'Santorini',
      description: 'Greece',
      lat: 36.3932,
      lon: 25.4615,
      tags: ['island', 'scenic'],
      Rating: '',
      Date: '',
      visited: false
    },
    {
      name: 'Victoria Falls',
      description: 'Zimbabwe/Zambia',
      lat: -17.9243,
      lon: 25.8562,
      tags: ['nature', 'waterfall'],
      Rating: '',
      Date: '',
      visited: false
    },
    {
      name: 'Petra',
      description: "Ma'an, Jordan",
      lat: 30.3285,
      lon: 35.4444,
      tags: ['landmark', 'historic'],
      Rating: '',
      Date: '',
      visited: false
    },
    {
      name: 'Yellowstone National Park',
      description: 'Wyoming, USA',
      lat: 44.428,
      lon: -110.5885,
      tags: ['nature', 'park'],
      Rating: '',
      Date: '',
      visited: false
    },
    {
      name: 'Galápagos Islands',
      description: 'Ecuador',
      lat: -0.9538,
      lon: -90.9656,
      tags: ['nature', 'islands'],
      Rating: '',
      Date: '',
      visited: false
    },
    {
      name: 'Mount Kilimanjaro',
      description: 'Tanzania',
      lat: -3.0674,
      lon: 37.3556,
      tags: ['nature', 'mountain'],
      Rating: '',
      Date: '',
      visited: false
    },
    {
      name: 'South Pole Station',
      description: 'Antarctica',
      lat: -90.0,
      lon: 0.0,
      tags: ['research', 'extreme'],
      Rating: '',
      Date: '',
      visited: false
    },
    {
      name: 'Table Mountain',
      description: 'Cape Town, South Africa',
      lat: -33.9628,
      lon: 18.4098,
      tags: ['nature', 'mountain'],
      Rating: '',
      Date: '',
      visited: false
    },
    {
      name: 'Hagia Sophia',
      description: 'Istanbul, Turkey',
      lat: 41.0086,
      lon: 28.9802,
      tags: ['landmark', 'historic', 'architecture'],
      Rating: '',
      Date: '',
      visited: false
    },
    {
      name: 'Stonehenge',
      description: 'Wiltshire, United Kingdom',
      lat: 51.1789,
      lon: -1.8262,
      tags: ['landmark', 'historic'],
      Rating: '',
      Date: '',
      visited: false
    },
    {
      name: 'Ubud',
      description: 'Bali, Indonesia',
      lat: -8.5069,
      lon: 115.2625,
      tags: ['culture', 'scenic'],
      Rating: '',
      Date: '',
      visited: false
    },
    {
      name: 'Fiordland National Park',
      description: 'South Island, New Zealand',
      lat: -45.415,
      lon: 167.718,
      tags: ['nature', 'park'],
      Rating: '',
      Date: '',
      visited: false
    },
    {
      name: 'Iguazu Falls',
      description: 'Argentina/Brazil',
      lat: -25.6953,
      lon: -54.4367,
      tags: ['nature', 'waterfall'],
      Rating: '',
      Date: '',
      visited: false
    }
  ];
  return sample.sort(() => Math.random() - 0.5);
}

