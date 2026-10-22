const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type',
}

type SteamPlayer = {
  steamid: string
  personaname: string
  profileurl: string
  avatarfull: string
}

function formatPlayer(player: SteamPlayer) {
  return {
    steamId: player.steamid,
    name: player.personaname,
    avatarUrl: player.avatarfull,
    profileUrl: player.profileurl,
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', {
      headers: corsHeaders,
    })
  }

  try {
    const body = await req.json()

    const url = body.url
    let steamId = body.steamId

    const steamIds: string[] | undefined =
      Array.isArray(body.steamIds)
        ? body.steamIds
        : undefined

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

    /*
     * BATCH PROFILE LOOKUP
     *
     * Used when refreshing existing accounts.
     */
    if (steamIds) {
      const cleanSteamIds = [
        ...new Set(
          steamIds
            .filter((id) => typeof id === 'string')
            .map((id) => id.trim())
            .filter(Boolean)
        ),
      ]

      if (cleanSteamIds.length === 0) {
        return Response.json(
          { error: 'At least one Steam ID is required' },
          {
            status: 400,
            headers: corsHeaders,
          }
        )
      }

      /*
       * Keep each batch reasonably small.
       */
      if (cleanSteamIds.length > 100) {
        return Response.json(
          { error: 'Maximum 100 Steam IDs per request' },
          {
            status: 400,
            headers: corsHeaders,
          }
        )
      }

      const profileUrl =
        `https://api.steampowered.com/ISteamUser/GetPlayerSummaries/v2/` +
        `?key=${apiKey}` +
        `&steamids=${encodeURIComponent(cleanSteamIds.join(','))}`

      const profileResponse = await fetch(profileUrl)

      if (!profileResponse.ok) {
        console.error(
          'Steam batch request failed:',
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

      const players: SteamPlayer[] =
        profileData.response?.players ?? []

      return Response.json(
        {
          profiles: players.map(formatPlayer),
        },
        {
          headers: corsHeaders,
        }
      )
    }

    /*
     * SINGLE PROFILE LOOKUP
     *
     * Used when adding an account.
     */

    if (!steamId) {
      if (!url) {
        return Response.json(
          { error: 'Steam URL or Steam ID required' },
          {
            status: 400,
            headers: corsHeaders,
          }
        )
      }

      let steamUrl: URL

      try {
        steamUrl = new URL(url)
      } catch {
        return Response.json(
          { error: 'Invalid Steam profile URL' },
          {
            status: 400,
            headers: corsHeaders,
          }
        )
      }

      if (
        steamUrl.hostname !== 'steamcommunity.com' &&
        steamUrl.hostname !== 'www.steamcommunity.com'
      ) {
        return Response.json(
          { error: 'Invalid Steam profile URL' },
          {
            status: 400,
            headers: corsHeaders,
          }
        )
      }

      const parts = steamUrl.pathname
        .split('/')
        .filter(Boolean)

      /*
       * steamcommunity.com/profiles/7656119...
       */
      if (parts[0] === 'profiles' && parts[1]) {
        steamId = parts[1]
      }

      /*
       * steamcommunity.com/id/customname
       */
      else if (parts[0] === 'id' && parts[1]) {
        const vanityName = parts[1]

        const resolveUrl =
          `https://api.steampowered.com/ISteamUser/ResolveVanityURL/v1/` +
          `?key=${apiKey}` +
          `&vanityurl=${encodeURIComponent(vanityName)}`

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

        if (
          resolveData.response?.success !== 1 ||
          !resolveData.response?.steamid
        ) {
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
    }

    if (!steamId) {
      return Response.json(
        { error: 'Invalid Steam profile' },
        {
          status: 400,
          headers: corsHeaders,
        }
      )
    }

    /*
     * Get current profile data for one account.
     */
    const profileUrl =
      `https://api.steampowered.com/ISteamUser/GetPlayerSummaries/v2/` +
      `?key=${apiKey}` +
      `&steamids=${encodeURIComponent(steamId)}`

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

    const player: SteamPlayer | undefined =
      profileData.response?.players?.[0]

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
      formatPlayer(player),
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
