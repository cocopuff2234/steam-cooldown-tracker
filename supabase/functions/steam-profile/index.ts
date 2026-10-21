Deno.serve(async (req) => {
  try {
    const { url } = await req.json()

    if (!url) {
      return Response.json(
        { error: 'Steam URL required' },
        { status: 400 }
      )
    }

    const apiKey = Deno.env.get('STEAM_API_KEY')

    if (!apiKey) {
      return Response.json(
        { error: 'Steam API key not configured' },
        { status: 500 }
      )
    }

    const steamUrl = new URL(url)
    const parts = steamUrl.pathname.split('/').filter(Boolean)

    let steamId: string | null = null

    // steamcommunity.com/profiles/7656119...
    if (parts[0] === 'profiles' && parts[1]) {
      steamId = parts[1]
    }

    // steamcommunity.com/id/customname
    else if (parts[0] === 'id' && parts[1]) {
      const vanityName = parts[1]

      const resolveUrl =
        `https://api.steampowered.com/ISteamUser/ResolveVanityURL/v1/` +
        `?key=${apiKey}&vanityurl=${encodeURIComponent(vanityName)}`

      const resolveResponse = await fetch(resolveUrl)
      const resolveData = await resolveResponse.json()

      if (resolveData.response.success !== 1) {
        return Response.json(
          { error: 'Could not find Steam user' },
          { status: 404 }
        )
      }

      steamId = resolveData.response.steamid
    }

    if (!steamId) {
      return Response.json(
        { error: 'Invalid Steam profile URL' },
        { status: 400 }
      )
    }

    // Get profile information
    const profileUrl =
      `https://api.steampowered.com/ISteamUser/GetPlayerSummaries/v2/` +
      `?key=${apiKey}&steamids=${steamId}`

    const profileResponse = await fetch(profileUrl)
    const profileData = await profileResponse.json()

    const player = profileData.response.players[0]

    if (!player) {
      return Response.json(
        { error: 'Steam profile not found' },
        { status: 404 }
      )
    }

    return Response.json({
      steamId: player.steamid,
      name: player.personaname,
      avatarUrl: player.avatarfull,
      profileUrl: player.profileurl,
    })
  } catch (error) {
    console.error(error)

    return Response.json(
      { error: 'Failed to retrieve Steam profile' },
      { status: 500 }
    )
  }
})
