import os
import glob
from PIL import Image, ImageOps

def optimize_image(source_path, dest_path, max_width=1200):
    try:
        with Image.open(source_path) as img:
            # Fix EXIF orientation by transposing pixels
            img = ImageOps.exif_transpose(img)

            # Convert to RGB if necessary (e.g. RGBA png)
            if img.mode in ("RGBA", "P"):
                img = img.convert("RGB")
            
            # Calculate new size preserving aspect ratio
            if img.width > max_width:
                ratio = max_width / float(img.width)
                new_height = int((float(img.height) * float(ratio)))
                img = img.resize((max_width, new_height), Image.Resampling.LANCZOS)
            
            # Save optimized
            img.save(dest_path, "JPEG", quality=85, optimize=True)
            print(f"Optimized: {os.path.basename(source_path)}")
    except Exception as e:
        print(f"Error optimizing {source_path}: {e}")

def process_directory(src_dir, dest_dir):
    os.makedirs(dest_dir, exist_ok=True)
    images = glob.glob(os.path.join(src_dir, '*.[jJ][pP]*[gG]')) + glob.glob(os.path.join(src_dir, '*.[pP][nN][gG]'))
    for idx, img_path in enumerate(images):
        dest_path = os.path.join(dest_dir, f"img_{idx+1}.jpg")
        optimize_image(img_path, dest_path)

if __name__ == "__main__":
    base_dest = r"f:\Project\portfolio\images\hobbies"
    
    dirs_to_process = {
        r"f:\Project\Games\Football": os.path.join(base_dest, "football"),
        r"f:\Project\Games\Volleyball": os.path.join(base_dest, "volleyball"),
        r"f:\Project\Hobbies\Dance": os.path.join(base_dest, "dance"),
        r"f:\Project\Hobbies\Nature": os.path.join(base_dest, "nature_all") # We will split this later
    }
    
    for src, dest in dirs_to_process.items():
        print(f"Processing {src}...")
        process_directory(src, dest)
