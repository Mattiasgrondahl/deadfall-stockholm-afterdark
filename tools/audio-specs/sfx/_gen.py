import json, os
SFX = [
  ("sfx_shotgun", 3, "A single heavy shotgun blast: sharp crack of a muzzle report, deep booming low-end thump, short rolling rumble tail, close-mic dry recording, no reverb, single shot only."),
  ("sfx_pistol", 2, "A single pistol gunshot: crisp sharp crack with a short dry tail, close-mic, no reverb, one shot only."),
  ("sfx_sniper", 3, "A single rifle sniper shot: sharp high crack report followed by a deep body thump and a short rolling tail, close-mic, dry, one shot only."),
  ("sfx_reload", 2, "A firearm reload: metallic slide rack and magazine click-clack mechanical foley, dry close-mic, no reverb."),
  ("sfx_dryfire", 1, "An empty chamber dry-fire click: a single sharp hollow metallic click, dry close-mic, no reverb."),
  ("sfx_growl_walker", 3, "A low guttural zombie growl, raspy undead throat, menacing and wet, single short growl, close-mic dry."),
  ("sfx_growl_brute", 4, "A deep heavy monstrous zombie roar, guttural and bassy, menacing brute growl, single short roar, close-mic dry."),
  ("sfx_zombie_death", 3, "A zombie death groan: a dying undead moan falling in pitch, wet gurgling death rattle, single short sound, close-mic dry."),
  ("sfx_hit_flesh", 1, "A bullet impact hitting flesh: a short dull wet thud slap, close-mic dry, single impact."),
  ("sfx_pickup", 1, "A video game item pickup blip: a short bright clean synthetic confirmation chime, one short blip."),
  ("sfx_melee_swing", 1, "A melee weapon whoosh: a fast swishing air swing whoosh, single short swing, dry."),
]
os.makedirs("tools/audio-specs/sfx", exist_ok=True)
for name, dur, prompt in SFX:
    spec = {"kind":"audio","model_type":"stable_audio3_small_sfx","name":name,
            "duration_seconds":dur,"prompt":prompt,"seed":1000+abs(hash(name))%9000}
    with open(f"tools/audio-specs/sfx/{name}.json","w") as f:
        json.dump(spec,f,indent=2)
print("wrote", len(SFX), "specs")
