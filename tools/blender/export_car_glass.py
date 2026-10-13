"""Export replacement glazing from the approved damage file, without studio objects."""
from pathlib import Path

import bmesh
import bpy
from io_scene_gltf2 import get_format_items
from mathutils import Matrix


def export_car_glass():
    project = Path(bpy.data.filepath)
    if project.name != "supercar_damage.blend":
        raise RuntimeError("Open art/supercar_damage.blend before exporting")
    output = project.parent.parent / "public" / "assets" / "supercar_glass_damage.glb"
    if not output.parent.is_dir():
        raise RuntimeError("Project assets directory is missing")

    scene = bpy.context.scene
    selected = list(bpy.context.selected_objects)
    active = bpy.context.view_layer.objects.active
    collection = bpy.data.collections.new("TEMP_Glass_Export")
    scene.collection.children.link(collection)
    temporary = []
    try:
        body = bpy.data.objects["Body"]
        remaining = body.data.copy()
        obj = bpy.data.objects.new("Game_Glass_Remainder", remaining)
        collection.objects.link(obj)
        temporary.append(obj)
        bm = bmesh.new()
        try:
            bm.from_mesh(remaining)
            bmesh.ops.delete(bm, geom=[
                f for f in bm.faces
                if "GlassWindshield" not in remaining.materials[f.material_index].name
            ], context="FACES")
            bmesh.ops.delete(bm, geom=[v for v in bm.verts if not v.link_faces], context="VERTS")
            bm.to_mesh(remaining)
        finally:
            bm.free()
        remaining.transform(body.matrix_world)
        remaining.materials.clear()
        remaining.materials.append(bpy.data.materials["GC_GlassWindshield"])
        for polygon in remaining.polygons:
            polygon.material_index = 0

        depsgraph = bpy.context.evaluated_depsgraph_get()
        for name in ["Damage_Windshield", "Damage_Radial_Fractures",
                     "Damage_Attached_Shards", "Damage_Hood_Fragments"]:
            source = bpy.data.objects[name]
            evaluated = source.evaluated_get(depsgraph)
            mesh = bpy.data.meshes.new_from_object(evaluated, depsgraph=depsgraph)
            mesh.transform(source.matrix_world)
            obj = bpy.data.objects.new("Game_" + name, mesh)
            obj.matrix_world = Matrix.Identity(4)
            collection.objects.link(obj)
            temporary.append(obj)

        bpy.ops.object.select_all(action="DESELECT")
        for obj in temporary:
            obj.select_set(True)
        bpy.context.view_layer.objects.active = temporary[0]
        assert "GLB" in {item[0] for item in get_format_items(scene, bpy.context)}
        result = bpy.ops.export_scene.gltf(
            filepath=str(output), export_format="GLB", use_selection=True,
            export_animations=False, export_yup=True,
            export_draco_mesh_compression_enable=False,
        )
        if "FINISHED" not in result:
            raise RuntimeError(f"Export failed: {result}")
        print(f"Exported {output.name}: {output.stat().st_size} bytes, {len(temporary)} meshes")
    finally:
        for obj in temporary:
            mesh = obj.data
            bpy.data.objects.remove(obj, do_unlink=True)
            bpy.data.meshes.remove(mesh)
        bpy.data.collections.remove(collection)
        for obj in selected:
            obj.select_set(True)
        bpy.context.view_layer.objects.active = active


export_car_glass()
