const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type',
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', {
      headers: corsHeaders,
    })
  }

  try {
    const { url } = await req.json()

    if (!url) {
      return Response.json(
        { error: 'Steam URL required' },
        {
          status: 400,
          headers: corsHeaders,
        }
      )
    }

    const apiKey = Deno.env.get('STEAM_API_KEY')

    if (!apiKey) {
      return Response.json(
        { error: 'Steam API key not configured' },
        {
          status: 500,
          headers: corsHeaders,
        }
      )
    }

    const steamUrl = new URL(url)
    const parts = steamUrl.pathname.split('/').filter(Boolean)

    let steamId: string | null = null

    // Example:
    // steamcommunity.com/profiles/76561198...
    if (parts[0] === 'profiles' && parts[1]) {
      steamId = parts[1]
    }

    // Example:
    // steamcommunity.com/id/username
    else if (parts[0] === 'id' && parts[1]) {
      const vanityName = parts[1]

      const resolveUrl =
        `https://api.steampowered.com/ISteamUser/ResolveVanityURL/v1/` +
        `?key=${apiKey}&vanityurl=${encodeURIComponent(vanityName)}`

      const resolveResponse = await fetch(resolveUrl)

      if (!resolveResponse.ok) {
        console.error(
          'ResolveVanityURL failed:',
          resolveResponse.status
        )

        return Response.json(
          { error: 'Steam API request failed' },
          {
            status: 502,
            headers: corsHeaders,
          }
        )
      }

      const resolveData = await resolveResponse.json()

      if (resolveData.response.success !== 1) {
        return Response.json(
          { error: 'Could not find Steam user' },
          {
            status: 404,
            headers: corsHeaders,
          }
        )
      }

      steamId = resolveData.response.steamid
    }

    if (!steamId) {
      return Response.json(
        { error: 'Invalid Steam profile URL' },
        {
          status: 400,
          headers: corsHeaders,
        }
      )
    }

    const profileUrl =
      `https://api.steampowered.com/ISteamUser/GetPlayerSummaries/v2/` +
      `?key=${apiKey}&steamids=${steamId}`

    const profileResponse = await fetch(profileUrl)

    if (!profileResponse.ok) {
      console.error(
        'GetPlayerSummaries failed:',
        profileResponse.status
      )

      return Response.json(
        { error: 'Steam API request failed' },
        {
          status: 502,
          headers: corsHeaders,
        }
      )
    }

    const profileData = await profileResponse.json()
    const player = profileData.response.players[0]

    if (!player) {
      return Response.json(
        { error: 'Steam profile not found' },
        {
          status: 404,
          headers: corsHeaders,
        }
      )
    }

    return Response.json(
      {
        steamId: player.steamid,
        name: player.personaname,
        avatarUrl: player.avatarfull,
        profileUrl: player.profileurl,
      },
      {
        headers: corsHeaders,
      }
    )
  } catch (error) {
    console.error('steam-profile error:', error)

    return Response.json(
      { error: 'Failed to retrieve Steam profile' },
      {
        status: 500,
        headers: corsHeaders,
      }
    )
  }
})
